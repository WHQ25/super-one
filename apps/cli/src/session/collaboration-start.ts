import { readAgentProfile } from '@superone/shared/agent-profile'
import { rollbackUnusedWorktree, worktreeGit } from '@superone/runtime/git/worktree-ops'
import { existsSync, statSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import {
  SESSION_AGENT_LAUNCHES_FIELD,
  type SessionAgentLaunchConfig,
  type SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import { launchedSessionPromptAppend } from './collaboration-profiles'
import { profileLaunchConfig } from '@superone/shared/agent-profile-launch'
import type { HarnessId } from '@superone/shared/session-types'
import {
  CollaborationError,
  collaborationSessionTitle,
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
  assertControl?: () => void
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
  const next = patchEditableLaunchConfig(parseGrantConfig<NodeLaunchConfig>(grant.config_json), patch)
  delete next.followsDefaults
  ctx.store.updateConfig(grant.grant_id, next)
  return { ...grant, config_json: JSON.stringify(next) }
}

async function deliverInitialTask(ctx: CollaborationContext, grant: GrantRow, childSessionId: string): Promise<void> {
  if (grant.task_sent === 1) return
  const config = parseGrantConfig(grant.config_json)
  const parentTitle = ctx.deps.sessions.get(grant.parent_session_id)?.title?.trim() || null
  const text = grant.kind === 'handoff'
    ? handoffTaskContent({ parentSessionId: grant.parent_session_id, parentTitle, task: grant.task })
    : grant.task
  try {
    await ctx.deps.sessions.sendWithoutLease({
      sessionId: childSessionId,
      text,
      model: config.model,
      effort: config.effort,
      permissionMode: config.permissionMode,
      sandboxMode: config.sandboxMode,
      claudeFastMode: config.claudeFastMode,
      apiProviderId: config.apiProviderId,
      // The parent agent's words, not the user's: never stamped human-typed.
      source: 'collaboration',
      collaboration: { kind: 'initial_task', ...(parentTitle ? { fromSessionTitle: parentTitle } : {}) },
      requestId: `collaboration-task-${grant.grant_id.slice(0, 16)}`,
    })
  } catch {
    // Turn may fail without a real harness; still mark task enqueued so start
    // remains idempotent for the child session create path.
  }
  ctx.store.markTaskSent(grant.grant_id)
}

function wakeLinkPeer(
  ctx: CollaborationContext,
  sessionId: string,
  grant: GrantRow,
  hasOpening: boolean,
): void {
  ctx.wakes.enqueue(sessionId, `collab-link:${grant.grant_id}`,
    linkActivationWakeText({
        initiatorSessionId: grant.parent_session_id,
        initiatorTitle: initiatorTitleOf(ctx, grant),
        hasOpening,
    }))
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
  input.assertControl?.()
  let grant = prepareLaunchStart(ctx.store, input.callerSessionId, input)

  const usedDefaultProfileApproval = parseGrantConfig<NodeLaunchConfig>(grant.config_json).followsDefaults
  const assertProfileEnabled = () => {
    if (!ctx.deps.experimentalAgentProfilesEnabled?.()
      && (usedDefaultProfileApproval
        || readAgentProfile(ctx.deps.sessionProviders?.get(grant.agent_id)?.config))) {
      throw new CollaborationError('Agent Profiles is experimental and disabled. Enable it before launching this Profile.', 'failed_precondition')
    }
  }
  if (grant.kind !== 'link' && grant.task_sent !== 1) assertProfileEnabled()

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
    if (existing) ctx.deps.sessions.setSystemPromptAppend(existing.sessionId, launchedSessionPromptAppend(ctx.deps, grant))
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

  let config = parseGrantConfig<NodeLaunchConfig>(grant.config_json)
  const projectId = config.projectId ?? parent.projectId
  let cwd = resolveCwd(ctx, config, projectId, parent.cwd)
  const sourceCwd = cwd
  const rollbackWorktree = () => config.worktree?.enabled && !config.worktreePath ? rollbackUnusedWorktree(worktreeGit(), sourceCwd, cwd, { ...config.worktree, mode: config.worktree.mode ?? 'branch' }).catch(() => {}) : Promise.resolve()
  if (config.worktreePath && typeof config.worktreePath === 'string' && config.worktreePath.trim()) {
    cwd = pathResolve(config.worktreePath.trim())
  } else if (config.worktree?.enabled) {
    cwd = (await ctx.deps.workspaceGit.activateWorktree(projectId, {
      baseBranch: config.worktree.baseBranch || 'HEAD',
      mode: config.worktree.mode ?? 'branch',
      branchName: config.worktree.branchName,
      carryLocalChanges: config.worktree.carryLocalChanges,
    })).path
  }
  try { input.assertControl?.(); assertProfileEnabled() } catch (error) { await rollbackWorktree(); throw error }

  const profile = resolveProfile(new Map(ctx.listProfiles().map((p) => [p.id, p])), grant.agent_id)
  if (config.followsDefaults) {
    if (!profile?.followsDefaults) {
      await rollbackWorktree()
      throw new CollaborationError('Default Profile is no longer available', 'failed_precondition')
    }
    const { launchId, summary } = parseGrantConfig<{ launchId: string; summary: string }>(grant.config_json)
    config = Object.assign(profileLaunchConfig(config, profile.defaultConfig), { followsDefaults: true, launchId, summary })
    ctx.store.updateConfig(grant.grant_id, config)
    grant = { ...grant, config_json: JSON.stringify(config) }
  }
  const harnessId = (profile?.harnessId
    ?? normalizeSessionHarnessId(grant.agent_id)
    ?? 'claude') as HarnessId
  const displayName = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({ role: config.role, task: grant.task })
  const title = collaborationSessionTitle(displayName, role)

  let child
  try {
    child = ctx.deps.sessions.create({
      projectId,
      harnessId,
      providerId: grant.agent_id,
      title,
      cwd,
      model: config.model ?? null,
      effort: config.effort ?? null,
      permissionMode: config.permissionMode ?? null,
      sandboxMode: config.sandboxMode ?? null,
      claudeFastMode: config.claudeFastMode ?? null,
      apiProviderId: config.apiProviderId ?? null,
      // The one profile option this node's runtime takes (see NODE_APPLIABLE_OPTIONS).
      agent: config.options?.agent ?? null,
      controllerClientSessionId: input.controllerClientSessionId ?? parent.controllerClientSessionId,
      systemPromptAppend: launchedSessionPromptAppend(ctx.deps, grant) ?? null,
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
    await rollbackWorktree()
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
      claudeFastMode: config.claudeFastMode,
      cwd,
      apiProviderId: config.apiProviderId ?? null,
      name: displayName,
      role,
      ...(config.worktree ? { worktree: config.worktree } : {}),
      ...(config.worktreePath ? { worktreePath: config.worktreePath } as never : {}),
    },
  }
}
