import { existsSync, statSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import {
  SESSION_AGENT_LAUNCHES_FIELD,
  type SessionAgentLaunchConfig,
  type SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import {
  CollaborationError,
  collaborationSessionTitle,
  collaborationSystemPrompt,
  deriveCollaborationName,
  deriveCollaborationRole,
  describeLaunchedPeer,
  handoffTaskContent,
  linkActivationWakeText,
  parseGrantConfig,
  patchEditableLaunchConfig,
  prepareLaunchStart,
  type CollaborationGrantRow as GrantRow,
} from '@superone/runtime/collaboration'
import {
  initiatorTitleOf,
  resolveProfile,
  type CollaborationContext,
  type NodeLaunchConfig,
} from './collaboration-context'

export interface CollaborationStartInput {
  /** The session that requested the launch; launchIds are scoped to it. */
  callerSessionId: string
  launchId: string
  /** Full Markdown brief. Required for spawn/handoff; a link's optional opening message. */
  task?: string
  formAnswers?: Record<string, unknown>
  /** Optional controller identity to bind on the child session. */
  controllerClientSessionId?: string | null
}

export interface CollaborationStartResult {
  status: 'started' | 'linked'
  mode: SessionCollabLaunchMode
  sessionId: string
  peerSessionId?: string
  reused: boolean
  name: string
  role: string
  title: string
  config: SessionAgentLaunchConfig
}

function resolveCwd(
  ctx: CollaborationContext,
  config: NodeLaunchConfig,
  projectId: string,
  parentCwd: string | null,
): string {
  const project = ctx.deps.projects.get(projectId)
  const fallback = parentCwd || project?.path || process.cwd()
  const cwd = pathResolve(config.cwd || fallback)
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new CollaborationError(`Working directory does not exist: ${cwd}`, 'invalid_argument')
  }
  return cwd
}

/** RPC start path: patch a single grant with the confirm form's editable fields. */
function applyFormAnswers(ctx: CollaborationContext, grant: GrantRow, formAnswers: Record<string, unknown>): GrantRow {
  const packed = formAnswers[SESSION_AGENT_LAUNCHES_FIELD]
  if (typeof packed !== 'string') return grant
  let edited: unknown
  try {
    edited = JSON.parse(packed)
  } catch {
    return grant
  }
  if (!Array.isArray(edited) || edited.length === 0) return grant
  const patch = (edited[0] as { config?: unknown } | null)?.config
  if (!patch || typeof patch !== 'object') return grant
  const next = patchEditableLaunchConfig(parseGrantConfig(grant.config_json), patch)
  ctx.store.updateConfig(grant.grant_id, next)
  return { ...grant, config_json: JSON.stringify(next) }
}

async function deliverInitialTask(ctx: CollaborationContext, grant: GrantRow, childSessionId: string): Promise<void> {
  if (grant.task_sent === 1) return
  const config = parseGrantConfig(grant.config_json)
  const text = grant.kind === 'handoff'
    ? handoffTaskContent({
      parentSessionId: grant.parent_session_id,
      parentTitle: ctx.deps.sessions.get(grant.parent_session_id)?.title?.trim() || null,
      task: grant.task,
    })
    : grant.task
  try {
    await ctx.deps.sessions.sendWithoutLease({
      sessionId: childSessionId,
      text,
      model: config.model,
      effort: config.effort,
      permissionMode: config.permissionMode,
      sandboxMode: config.sandboxMode,
      apiProviderId: config.apiProviderId,
      requestId: `collaboration-task-${grant.grant_id.slice(0, 16)}`,
    })
  } catch {
    // Turn may fail without a real harness; still mark task enqueued so start
    // remains idempotent for the child session create path.
  }
  ctx.store.markTaskSent(grant.grant_id)
}

async function wakeLinkPeer(
  ctx: CollaborationContext,
  sessionId: string,
  grant: GrantRow,
  hasOpening: boolean,
): Promise<void> {
  if (!ctx.deps.sessions.get(sessionId)) return
  try {
    await ctx.deps.sessions.sendWithoutLease({
      sessionId,
      text: linkActivationWakeText({
        initiatorSessionId: grant.parent_session_id,
        initiatorTitle: initiatorTitleOf(ctx, grant),
        hasOpening,
      }),
      source: 'task-notification',
      requestId: `collab-link-wake-${grant.grant_id.slice(0, 12)}-${Date.now()}`,
    })
  } catch {
    /* best-effort */
  }
}

async function startLink(ctx: CollaborationContext, grant: GrantRow): Promise<CollaborationStartResult> {
  if (!grant.child_session_id) {
    throw new CollaborationError('Link grant is missing peer session id', 'failed_precondition')
  }
  const peerSessionId = grant.child_session_id
  if (!ctx.deps.sessions.get(peerSessionId)) {
    throw new CollaborationError(`Peer session no longer exists: ${peerSessionId}`, 'not_found')
  }
  const alreadyStarted = Boolean(grant.started_at)
  if (!alreadyStarted) ctx.store.markStarted(grant.grant_id)
  const opening = grant.task?.trim() ?? ''
  if (!alreadyStarted && opening) {
    // Deliver the opening as a mailbox message (never system prompt).
    if (grant.task_sent !== 1) {
      ctx.store.appendLinkOpening(grant, peerSessionId, opening)
      void wakeLinkPeer(ctx, peerSessionId, grant, true)
    }
  } else {
    void wakeLinkPeer(ctx, peerSessionId, grant, false)
    if (!alreadyStarted) ctx.store.markTaskSent(grant.grant_id)
  }
  const peer = describeLaunchedPeer(grant)
  return {
    status: 'linked',
    mode: 'link',
    sessionId: peerSessionId,
    peerSessionId,
    reused: alreadyStarted,
    name: peer.name,
    role: peer.role,
    title: peer.title,
    config: peer.config,
  }
}

export async function startCollaboration(
  ctx: CollaborationContext,
  input: CollaborationStartInput,
): Promise<CollaborationStartResult> {
  let grant = prepareLaunchStart(ctx.store, input.callerSessionId, input)

  // formAnswers may patch editable launch config (desktop confirm UI parity).
  // Link grants ignore form config patches.
  if (grant.kind !== 'link' && input.formAnswers && typeof input.formAnswers === 'object') {
    grant = applyFormAnswers(ctx, grant, input.formAnswers)
  }
  if (grant.kind === 'link') return startLink(ctx, grant)

  // spawn + handoff both create a session and deliver the task; a handoff
  // session id lives in config_json, never in child_session_id.
  const isHandoff = grant.kind === 'handoff'
  const existingHandoffSessionId = isHandoff
    ? parseGrantConfig<{ handoffSessionId?: string }>(grant.config_json).handoffSessionId
    : undefined
  const existingSessionId = existingHandoffSessionId ?? grant.child_session_id
  if (existingSessionId) {
    const existing = ctx.deps.sessions.get(existingSessionId)
    // Unlike a spawn child, a handoff session is not FK-linked to the grant, so
    // deleting it leaves this row behind — do not report a dead session as started.
    if (isHandoff && !existing) {
      throw new CollaborationError(`The handoff session no longer exists: ${existingSessionId}`, 'not_found')
    }
    if (existing && !isHandoff) {
      ctx.deps.sessions.setSystemPromptAppend(
        existing.sessionId,
        collaborationSystemPrompt(grant.parent_session_id),
      )
    }
    if (existing) await deliverInitialTask(ctx, grant, existingSessionId)
    const peer = describeLaunchedPeer(grant)
    return {
      status: 'started',
      mode: grant.kind,
      sessionId: existingSessionId,
      reused: true,
      name: peer.name,
      role: peer.role,
      title: peer.title,
      config: peer.config,
    }
  }

  const parent = ctx.deps.sessions.get(grant.parent_session_id)
  if (!parent) throw new CollaborationError('Parent session is not available', 'not_found')

  const config = parseGrantConfig<NodeLaunchConfig>(grant.config_json)
  let cwd = resolveCwd(ctx, config, parent.projectId, parent.cwd)
  if (config.worktreePath && typeof config.worktreePath === 'string' && config.worktreePath.trim()) {
    cwd = pathResolve(config.worktreePath.trim())
  } else if (config.worktree?.enabled) {
    cwd = ctx.deps.workspaceGit.activateWorktree(parent.projectId, {
      baseBranch: config.worktree.baseBranch || 'HEAD',
      mode: config.worktree.mode ?? 'branch',
      branchName: config.worktree.branchName,
      carryLocalChanges: config.worktree.carryLocalChanges,
    }).path
  }

  const profile = resolveProfile(new Map(ctx.listProfiles().map((p) => [p.id, p])), grant.agent_id)
  const harnessId = (profile?.harnessId
    ?? normalizeSessionHarnessId(grant.agent_id)
    ?? 'claude') as HarnessId
  const displayName = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({ role: config.role, task: grant.task })
  const title = collaborationSessionTitle(displayName, role)

  let child
  try {
    child = ctx.deps.sessions.create({
      projectId: parent.projectId,
      harnessId,
      providerId: grant.agent_id,
      title,
      cwd,
      model: config.model ?? null,
      effort: config.effort ?? null,
      permissionMode: config.permissionMode ?? null,
      sandboxMode: config.sandboxMode ?? null,
      apiProviderId: config.apiProviderId ?? null,
      controllerClientSessionId: input.controllerClientSessionId ?? parent.controllerClientSessionId,
      // Handoff is one-way by construction: the receiver gets no collaboration prompt.
      ...(isHandoff
        ? {}
        : { systemPromptAppend: collaborationSystemPrompt(grant.parent_session_id) }),
    })
    ctx.store.bindStartedSession(grant, child.sessionId, config)
  } catch (err) {
    if (child?.sessionId) {
      try {
        ctx.deps.sessions.remove(child.sessionId)
      } catch {
        /* best-effort */
      }
    }
    throw err
  }

  grant = isHandoff ? grant : { ...grant, child_session_id: child.sessionId }
  await deliverInitialTask(ctx, grant, child.sessionId)

  ctx.deps.events.append({
    aggregateType: 'session',
    aggregateId: grant.parent_session_id,
    eventType: isHandoff ? 'collaboration.handoff_started' : 'collaboration.child_started',
    payload: { grantId: grant.grant_id, childSessionId: child.sessionId },
  })

  return {
    status: 'started',
    mode: grant.kind,
    sessionId: child.sessionId,
    reused: false,
    name: displayName,
    role,
    title,
    config: {
      model: config.model,
      effort: config.effort,
      fastMode: config.fastMode,
      permissionMode: config.permissionMode,
      sandboxMode: config.sandboxMode,
      cwd,
      apiProviderId: config.apiProviderId ?? null,
      name: displayName,
      role,
      ...(config.worktree ? { worktree: config.worktree } : {}),
      ...(config.worktreePath ? { worktreePath: config.worktreePath } as never : {}),
    },
  }
}
