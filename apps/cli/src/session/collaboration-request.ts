import { randomUUID } from 'node:crypto'
import type {
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import {
  CollaborationError,
  NESTED_COLLABORATION_UNSUPPORTED,
  assertLaunchCount,
  collaborationSessionTitle,
  mergeConfirmedLaunches,
  normalizeLaunchText,
  parseGrantConfig,
  resolveLaunchMode,
} from '@superone/runtime/collaboration'
import { resolveProfile, type CollaborationContext, type NodeLaunchConfig } from './collaboration-context'

export interface CollaborationRequestInput {
  parentSessionId: string
  launches: Array<{
    launchId?: string
    mode?: SessionCollabLaunchMode
    agentId?: string
    sessionId?: string
    /** Short confirm-UI description. Optional for spawn when task is present. */
    summary?: string
    task?: string
    name?: string
    role?: string
    config?: NodeLaunchConfig
  }>
  requireUserConfirm?: boolean
  signal?: AbortSignal
}

export interface ApprovedCollaborationLaunch {
  launchId: string
  mode: SessionCollabLaunchMode
  agentId: string
  sessionId?: string
  peerSessionId?: string
  summary: string
  task: string
  name: string
  role: string
  title: string
  config: SessionAgentLaunchConfig
  credential: string
  grantId: string
  reused?: boolean
}

export type CollaborationRequestResult =
  | { status: 'approved'; launches: ApprovedCollaborationLaunch[] }
  | { status: 'cancelled'; message?: string }
  | { status: 'rejected'; feedback?: unknown }

/**
 * Only allowlisted keys from launch.config may influence the grant.
 * permissionMode/sandboxMode always start at safe defaults for the RPC path;
 * elevation is only possible after the requireUserConfirm form merge.
 */
function safeLaunchConfig(raw: NodeLaunchConfig | undefined): NodeLaunchConfig {
  const config: NodeLaunchConfig = raw && typeof raw === 'object' ? raw : {}
  const safe: NodeLaunchConfig = {}
  if (typeof config.model === 'string' && config.model.trim()) safe.model = config.model.trim()
  if (typeof config.effort === 'string' && config.effort.trim()) safe.effort = config.effort.trim()
  if (config.apiProviderId === null) safe.apiProviderId = null
  else if (typeof config.apiProviderId === 'string' && config.apiProviderId.trim()) {
    safe.apiProviderId = config.apiProviderId.trim()
  }
  if (config.worktree && typeof config.worktree === 'object') safe.worktree = config.worktree
  if (typeof config.worktreePath === 'string' && config.worktreePath.trim()) {
    safe.worktreePath = config.worktreePath.trim()
  }
  if (typeof config.cwd === 'string' && config.cwd.trim()) safe.cwd = config.cwd.trim()
  return safe
}

function normalizeLaunches(
  ctx: CollaborationContext,
  input: CollaborationRequestInput,
  profileList: SessionAgentProfile[],
): SessionAgentLaunchProposal[] {
  const parent = ctx.deps.sessions.get(input.parentSessionId)!
  const profiles = new Map(profileList.map((p) => [p.id, p]))
  return input.launches.map((launch) => {
    const mode = resolveLaunchMode(launch.mode)
    const launchId = launch.launchId?.trim() || randomUUID()

    if (mode === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (!peerSessionId) {
        throw new CollaborationError('Link launches require sessionId of an existing SuperOne session', 'invalid_argument')
      }
      if (peerSessionId === input.parentSessionId) {
        throw new CollaborationError('Cannot link a session to itself', 'invalid_argument')
      }
      const peer = ctx.deps.sessions.get(peerSessionId)
      if (!peer) throw new CollaborationError(`Unknown sessionId for link: ${peerSessionId}`, 'not_found')
      const peerTitle = peer.title?.trim() || peerSessionId.slice(0, 8)
      const { summary, task, name, role } = normalizeLaunchText('link', launch, peerTitle)
      return {
        launchId,
        mode: 'link',
        agentId: '',
        sessionId: peerSessionId,
        peerTitle,
        peerProjectPath: ctx.deps.projects.get(peer.projectId)?.path,
        summary,
        task,
        name,
        role,
        config: { name, role, summary },
      }
    }

    // spawn + handoff share this whole branch; they differ only in nesting and
    // in whether the new session gets a mailbox credential.
    const agentId = launch.agentId?.trim()
    if (!agentId) {
      throw new CollaborationError(`${mode} launches require agentId from session_collab_list_agents`, 'invalid_argument')
    }
    const profile = resolveProfile(profiles, agentId)
    if (!profile) throw new CollaborationError(`Unknown agent profile: ${agentId}`, 'invalid_argument')
    const { summary, task, name, role } = normalizeLaunchText(mode, launch)
    const safe = safeLaunchConfig(launch.config)
    return {
      launchId,
      mode,
      agentId,
      summary,
      task,
      name,
      role,
      config: {
        ...profile.defaultConfig,
        ...safe,
        permissionMode: 'default',
        sandboxMode: 'off',
        cwd: safe.cwd ?? (parent.cwd ?? ctx.deps.projects.get(parent.projectId)?.path),
        name,
        role,
      },
    }
  })
}

function createGrant(
  ctx: CollaborationContext,
  parentSessionId: string,
  launch: SessionAgentLaunchProposal,
): ApprovedCollaborationLaunch {
  const mode = resolveLaunchMode(launch.mode)
  const title = collaborationSessionTitle(launch.name, launch.role)
  if (mode === 'link') {
    const peerSessionId = launch.sessionId!
    const existing = ctx.store.findLinkGrant(parentSessionId, peerSessionId)
    const existingCredential = existing ? ctx.store.credentialOf(existing) : null
    if (existing && existingCredential) {
      return {
        launchId: launch.launchId,
        mode: 'link',
        agentId: existing.agent_id,
        sessionId: peerSessionId,
        peerSessionId,
        summary: launch.summary,
        task: existing.task,
        name: launch.name,
        role: launch.role,
        title,
        config: parseGrantConfig(existing.config_json),
        credential: existingCredential,
        grantId: existing.credential_hash,
        reused: true,
      }
    }
    // Opening is optional: empty task means wake-only (no mailbox opening body).
    const task = launch.task.trim()
    const config = {
      name: launch.name,
      role: launch.role,
      summary: launch.summary,
      peerSessionId,
      peerTitle: launch.peerTitle,
      peerProjectPath: launch.peerProjectPath,
    }
    const { credential, credentialHash } = ctx.store.createGrant({
      kind: 'link',
      parentSessionId,
      childSessionId: peerSessionId,
      agentId: '',
      task,
      config,
    })
    ctx.deps.events.append({
      aggregateType: 'session',
      aggregateId: parentSessionId,
      eventType: 'collaboration.grant_created',
      payload: { grantId: credentialHash, mode: 'link', peerSessionId, launchId: launch.launchId },
    })
    return {
      launchId: launch.launchId,
      mode: 'link',
      agentId: '',
      sessionId: peerSessionId,
      peerSessionId,
      summary: launch.summary,
      task,
      name: launch.name,
      role: launch.role,
      title,
      config,
      credential,
      grantId: credentialHash,
      reused: false,
    }
  }

  const config = { ...launch.config, name: launch.name, role: launch.role, summary: launch.summary }
  const { credential, credentialHash } = ctx.store.createGrant({
    kind: mode,
    parentSessionId,
    agentId: launch.agentId,
    task: launch.task,
    config,
  })
  ctx.deps.events.append({
    aggregateType: 'session',
    aggregateId: parentSessionId,
    eventType: 'collaboration.grant_created',
    payload: { grantId: credentialHash, mode, agentId: launch.agentId, launchId: launch.launchId },
  })
  return {
    launchId: launch.launchId,
    mode,
    agentId: launch.agentId,
    summary: launch.summary,
    task: launch.task,
    name: launch.name,
    role: launch.role,
    title,
    config,
    credential,
    grantId: credentialHash,
    reused: false,
  }
}

/**
 * Request child launches. When `requireUserConfirm` is true (MCP tool path),
 * emits pendingInteraction kind session_agents_confirm and waits for the
 * desktop remote UI accept/decline/cancel (+ formAnswers).
 * RPC path defaults to auto-approve (already-trusted controller).
 */
export async function requestCollaboration(
  ctx: CollaborationContext,
  input: CollaborationRequestInput,
): Promise<CollaborationRequestResult> {
  if (!ctx.deps.sessions.get(input.parentSessionId)) {
    throw new CollaborationError('Parent session is not available', 'not_found')
  }
  if (ctx.store.isSpawnChild(input.parentSessionId)) {
    throw new CollaborationError(NESTED_COLLABORATION_UNSUPPORTED, 'failed_precondition')
  }
  if (!Array.isArray(input.launches)) {
    throw new CollaborationError('launches must contain at least one proposed session', 'invalid_argument')
  }
  assertLaunchCount(input.launches.length)

  const profileList = ctx.listProfiles()
  const normalized = normalizeLaunches(ctx, input, profileList)
  const launchIds = new Set(normalized.map((l) => l.launchId))
  if (launchIds.size !== normalized.length) {
    throw new CollaborationError('Every confirmed launch must have a unique launchId', 'invalid_argument')
  }

  let confirmed = normalized
  if (input.requireUserConfirm) {
    const outcome = await ctx.deps.sessions.requestAgentsConfirm({
      sessionId: input.parentSessionId,
      launches: normalized,
      profiles: profileList,
      signal: input.signal,
    })
    if (outcome.action === 'cancel') return { status: 'cancelled' }
    if (outcome.action === 'decline') return { status: 'rejected', feedback: outcome.content?.feedback }
    confirmed = mergeConfirmedLaunches(normalized, outcome.content)
  }

  const launches = ctx.store.transaction(() =>
    confirmed.map((launch) => createGrant(ctx, input.parentSessionId, launch)))
  return { status: 'approved', launches }
}
