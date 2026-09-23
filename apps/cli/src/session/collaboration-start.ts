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
  hashCollaborationCredential,
  linkActivationWakeText,
  parseGrantConfig,
  patchEditableLaunchConfig,
  type CollaborationGrantRow as GrantRow,
} from '@superone/runtime/collaboration'
import {
  initiatorTitleOf,
  resolveProfile,
  type CollaborationContext,
  type NodeLaunchConfig,
} from './collaboration-context'

export interface CollaborationStartInput {
  credential?: string
  grantId?: string
  formAnswers?: Record<string, unknown>
  /** When set (MCP tool path), must match the grant parent. */
  callerSessionId?: string
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
  credential: string
  grantId: string
}

function resolveGrant(ctx: CollaborationContext, credential?: string, grantId?: string): GrantRow | null {
  if (credential && credential.trim()) return ctx.store.grantByCredential(credential.trim())
  if (grantId && grantId.trim()) return ctx.store.grantByHash(grantId.trim())
  return null
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
  ctx.store.updateConfig(grant.credential_hash, next)
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
      requestId: `collaboration-task-${grant.credential_hash.slice(0, 16)}`,
    })
  } catch {
    // Turn may fail without a real harness; still mark task enqueued so start
    // remains idempotent for the child session create path.
  }
  ctx.store.markTaskSent(grant.credential_hash)
}

async function wakeLinkPeer(
  ctx: CollaborationContext,
  sessionId: string,
  credential: string,
  initiatorSessionId: string,
  initiatorTitle: string,
  hasOpening: boolean,
): Promise<void> {
  if (!ctx.deps.sessions.get(sessionId)) return
  try {
    await ctx.deps.sessions.sendWithoutLease({
      sessionId,
      text: linkActivationWakeText({ credential, initiatorSessionId, initiatorTitle, hasOpening }),
      source: 'task-notification',
      requestId: `collab-link-wake-${hashCollaborationCredential(credential).slice(0, 12)}-${Date.now()}`,
    })
  } catch {
    /* best-effort */
  }
}

async function startLink(
  ctx: CollaborationContext,
  grant: GrantRow,
  credential: string,
): Promise<CollaborationStartResult> {
  if (!grant.child_session_id) {
    throw new CollaborationError('Link grant is missing peer session id', 'failed_precondition')
  }
  const peerSessionId = grant.child_session_id
  if (!ctx.deps.sessions.get(peerSessionId)) {
    throw new CollaborationError(`Peer session no longer exists: ${peerSessionId}`, 'not_found')
  }
  const alreadyStarted = Boolean(grant.started_at)
  if (!alreadyStarted) ctx.store.markStarted(grant.credential_hash)
  const opening = grant.task?.trim() ?? ''
  const initiatorTitle = initiatorTitleOf(ctx, grant)
  if (!alreadyStarted && opening) {
    // Deliver the opening as a mailbox message (never system prompt).
    if (grant.task_sent !== 1) {
      ctx.store.appendLinkOpening(grant, peerSessionId, opening)
      void wakeLinkPeer(ctx, peerSessionId, credential, grant.parent_session_id, initiatorTitle, true)
    }
  } else {
    void wakeLinkPeer(ctx, peerSessionId, credential, grant.parent_session_id, initiatorTitle, false)
    if (!alreadyStarted) ctx.store.markTaskSent(grant.credential_hash)
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
    credential,
    grantId: grant.credential_hash,
  }
}

export async function startCollaboration(
  ctx: CollaborationContext,
  input: CollaborationStartInput,
): Promise<CollaborationStartResult> {
  let grant = resolveGrant(ctx, input.credential, input.grantId)
  if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
  // grantId alone (without the bearer credential) is a hash lookup that can
  // decrypt the stored secret. Require the caller to prove parent ownership.
  const hasBearer = typeof input.credential === 'string' && input.credential.trim().length > 0
  if (!hasBearer) {
    if (!input.callerSessionId || input.callerSessionId !== grant.parent_session_id) {
      throw new CollaborationError('grantId start requires callerSessionId matching the parent session', 'forbidden')
    }
  } else if (input.callerSessionId && grant.parent_session_id !== input.callerSessionId) {
    throw new CollaborationError('Only the parent session may start this credential', 'forbidden')
  }
  const credential = input.credential ?? ctx.store.credentialOf(grant)
  if (!credential) throw new CollaborationError('Invalid collaboration credential', 'not_found')

  // formAnswers may patch editable launch config (desktop confirm UI parity).
  // Link grants ignore form config patches.
  if (grant.kind !== 'link' && input.formAnswers && typeof input.formAnswers === 'object') {
    grant = applyFormAnswers(ctx, grant, input.formAnswers)
  }
  if (grant.kind === 'link') return startLink(ctx, grant, credential)

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
        collaborationSystemPrompt(credential, grant.parent_session_id),
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
      credential,
      grantId: grant.credential_hash,
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
      // Handoff is one-way by construction: never hand the receiver a credential.
      ...(isHandoff
        ? {}
        : { systemPromptAppend: collaborationSystemPrompt(credential, grant.parent_session_id) }),
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
    payload: { grantId: grant.credential_hash, childSessionId: child.sessionId },
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
    credential,
    grantId: grant.credential_hash,
  }
}
