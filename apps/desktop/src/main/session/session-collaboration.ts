import { randomUUID } from 'crypto'
import type {
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionAgentRemoteLaunch,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import {
  EDITABLE_PERMISSION_MODES,
  EDITABLE_SANDBOX_MODES,
  NESTED_COLLABORATION_UNSUPPORTED,
  assertLaunchCount,
  assertNotPeeredElsewhere,
  collaborationSystemPrompt,
  mergeConfirmedLaunches,
  normalizeLaunchLabels,
  parseGrantConfig as parseConfig,
  recordApprovedLaunch,
  resolveLaunchMode,
  START_APPROVED_LAUNCHES_HINT,
  type ApprovedLaunch,
} from '@superone/runtime/collaboration'
import { getDb } from '../database'
import { listSessionAgentProfiles } from './agent-profiles'
import { collaborationStore as store } from './collaboration-mailbox'
import { defaultLaunchCwd } from './collaboration-child-project'
import {
  isLocalEnvironment,
  listRemoteAgentEnvironments,
  planRemoteLaunch,
  remoteChildTarget,
  remoteProviderId,
} from './collaboration-remote'
import { resolveCodexServiceTier, toolResult } from './collaboration-host'
import type { Session, SessionManager } from './types'
import { openSessionAgentsConfirm } from './session-collaboration-confirm'
import { hasExternalParent } from './collaboration-external-parent'

export { setSessionCollaborationCallbacks } from './collaboration-host'
export { sendSessionMessage, retrieveSessionMessages, type SessionSendArgs, type SessionRetrieveArgs } from './collaboration-messaging'
import {
  retrieveSessionMessages,
  sendSessionMessage,
  type SessionRetrieveArgs,
  type SessionSendArgs,
} from './collaboration-messaging'
export { startSessionAgent, type SessionStartArgs } from './collaboration-start'

/**
 * Agent-profile listing moved to ./agent-profiles when this file passed 1600
 * lines. Re-exported here so existing importers keep resolving it from the
 * collaboration module.
 */
export { listSessionAgentProfiles } from './agent-profiles'

/**
 * session_collab_list_agents: this machine's profiles, plus each connected
 * machine with the profiles it can run (launch them with `environment`).
 */
export async function listCollaborationAgents(): Promise<{
  agents: SessionAgentProfile[]
  environments?: Awaited<ReturnType<typeof listRemoteAgentEnvironments>>
}> {
  const agents = listSessionAgentProfiles()
  const environments = await listRemoteAgentEnvironments(agents)
  return environments.length > 0 ? { agents, environments } : { agents }
}

export interface RequestSessionAgentsArgs {
  launches: Array<{
    launchId?: string
    /**
     * `spawn` (default) creates a nested child; `link` connects an existing
     * sessionId; `handoff` creates a top-level sibling that only receives the task.
     */
    mode?: SessionAgentLaunchProposal['mode']
    /** Required for spawn/handoff; ignored for link. */
    agentId?: string
    /** Required for link: existing SuperOne session id. */
    sessionId?: string
    /** Spawn only: environmentId of another connected machine to run the child on. */
    environment?: string
    /** What the launch is for; the user approves this. The brief goes to session_collab_start. */
    summary?: string
    /** Agent-chosen human label (not harness name). Used in `Name - Role`. */
    name?: string
    /** Temporary role for child title: `Name - Role`. */
    role?: string
    config?: SessionAgentLaunchConfig
  }>
}

export interface SessionCollaborationRunConfig {
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  codexServiceTier?: string | null
}


/**
 * `apiProviderId` is a credential id, and an unknown one is NOT an error further
 * down: the provider resolver silently falls back to the global binding, so the
 * child would quietly run on the default provider while the caller believes it
 * picked a third-party one. Reject it here (and again at grant time, which is the
 * choke point the confirm UI's edits also pass through) so a wrong id is a loud
 * failure with the valid ids attached, not a silent downgrade.
 */
function assertKnownApiProviderId(
  config: SessionAgentLaunchConfig | undefined,
  profile: SessionAgentProfile,
): void {
  const apiProviderId = config?.apiProviderId
  if (typeof apiProviderId !== 'string' || !apiProviderId.trim()) return
  if (profile.apiProviders.some((provider) => provider.id === apiProviderId)) return
  const known = profile.apiProviders.map((provider) => provider.id)
  throw new Error(
    `Unknown apiProviderId for agent ${profile.id}: ${apiProviderId}. `
    + 'It must be a credential id from session_collab_list_agents → agents[].apiProviders[].id'
    + (known.length > 0 ? ` (available: ${known.join(', ')})` : ' (this agent has no third-party providers configured)')
    + '. Omit it to follow the user\'s global provider binding.',
  )
}

function normalizeLaunches(
  args: RequestSessionAgentsArgs,
  parent: Session,
  remotes: ReadonlyMap<number, SessionAgentRemoteLaunch> = new Map(),
): SessionAgentLaunchProposal[] {
  if (!Array.isArray(args.launches)) throw new Error('launches must contain at least one proposed session')
  assertLaunchCount(args.launches.length)
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  return args.launches.map((launch, index) => {
    const mode = resolveLaunchMode(launch.mode)
    const launchId = launch.launchId?.trim() || randomUUID()

    if (mode === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (!peerSessionId) throw new Error('Link launches require sessionId of an existing SuperOne session')
      if (peerSessionId === parent.id) throw new Error('Cannot link a session to itself')
      // sessions store project_id; path lives on projects (post project_path migration).
      const peerRow = getDb().prepare(`
        SELECT s.id, s.title, p.path AS project_path, s.provider, s.provider_id, s.acp_agent_id
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = ?
      `).get(peerSessionId) as {
        id: string
        title: string | null
        project_path: string
        provider: string | null
        provider_id: string | null
        acp_agent_id: string | null
      } | undefined
      if (!peerRow) throw new Error(`Unknown sessionId for link: ${peerSessionId}`)
      assertNotPeeredElsewhere(store(), parent.id, peerSessionId)
      const peerTitle = peerRow.title?.trim() || peerSessionId.slice(0, 8)
      const { summary, name, role } = normalizeLaunchLabels('link', launch, peerTitle)
      // Confirm tabs show harness (same as spawn) — resolve from peer session identity.
      const peerHarnessId = (peerRow.provider?.trim()
        || peerRow.provider_id?.replace(/-base$/, '')
        || 'claude').toLowerCase()
      const peerAcpAgentId = peerRow.acp_agent_id?.trim() || undefined
      const peerBrandKey = resolveHarnessBrandKey(peerHarnessId, peerAcpAgentId)
      const matchedProfile = peerRow.provider_id
        ? profiles.get(peerRow.provider_id)
        : [...profiles.values()].find((p) => p.harnessId === peerHarnessId
          && (!peerAcpAgentId || p.acpAgentId === peerAcpAgentId))
      const peerHarnessName = matchedProfile?.name
        || (peerHarnessId === 'acp' && peerAcpAgentId
          ? acpAgentDisplayName(peerAcpAgentId)
          : peerHarnessId.charAt(0).toUpperCase() + peerHarnessId.slice(1))
      return {
        launchId,
        mode: 'link',
        agentId: '',
        sessionId: peerSessionId,
        peerTitle,
        peerProjectPath: peerRow.project_path,
        peerHarnessId,
        ...(peerAcpAgentId ? { peerAcpAgentId } : {}),
        peerHarnessName,
        peerBrandKey,
        summary,
        name,
        role,
        config: { name, role, summary },
      }
    }

    // spawn + handoff share the whole launch shape; they differ only in whether the
    // new session is nested under the initiator and gets a mailbox.
    const agentId = launch.agentId?.trim()
    if (!agentId) throw new Error(`${mode} launches require agentId from session_collab_list_agents`)
    const profile = profiles.get(agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${agentId}`)
    const { summary, name, role } = normalizeLaunchLabels(mode, launch)
    const remote = remotes.get(index)
    if (remote) return remoteLaunchProposal(launch, { launchId, profile, summary, name, role, remote })
    assertKnownApiProviderId(launch.config, profile)
    return {
      launchId,
      mode,
      agentId,
      summary,
      name,
      role,
      config: {
        ...profile.defaultConfig,
        permissionMode: 'default',
        sandboxMode: 'off',
        cwd: defaultLaunchCwd(parent),
        ...launch.config,
        name,
        role,
      },
    }
  })
}

/**
 * Resolve the launches that target another machine, by launch index. Only
 * spawn launches of a base profile without third-party keys can: the target
 * has its own provider bindings and none of this machine's keys.
 */
async function planRemoteLaunches(
  args: RequestSessionAgentsArgs,
  parent: Session,
): Promise<Map<number, SessionAgentRemoteLaunch>> {
  const localEnvironmentId = await localCollabEnvironmentId()
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  const plans = new Map<number, SessionAgentRemoteLaunch>()
  await Promise.all(args.launches.map(async (launch, index) => {
    if (isLocalEnvironment(launch.environment, localEnvironmentId)) return
    if (resolveLaunchMode(launch.mode) !== 'spawn') throw new Error('Only spawn launches can run on another machine')
    const profile = profiles.get(launch.agentId?.trim() ?? '')
    if (profile && profile.id !== remoteProviderId(profile.harnessId)) {
      throw new Error(
        `Agent ${profile.id} is a configuration of this machine; launch ${remoteProviderId(profile.harnessId)} on another machine.`,
      )
    }
    if (launch.config?.apiProviderId) {
      throw new Error('Third-party provider keys stay on this machine; omit apiProviderId for a launch on another machine.')
    }
    plans.set(index, await planRemoteLaunch(defaultLaunchCwd(parent), launch.environment!.trim()))
  }))
  return plans
}

async function localCollabEnvironmentId(): Promise<string | undefined> {
  try {
    const { getEnvironmentHost } = await import('../environment/environment-host')
    return (await getEnvironmentHost().getLocalGateway().getDescriptor()).environmentId
  } catch {
    return undefined
  }
}

/**
 * A spawn child on another machine. It runs that machine's base provider for
 * the harness in a fresh worktree of the same repository; this checkout's
 * cwd, worktree and third-party keys do not apply there.
 */
function remoteLaunchProposal(
  launch: RequestSessionAgentsArgs['launches'][number],
  input: {
    launchId: string
    profile: SessionAgentProfile
    summary: string
    name: string
    role: string
    remote: SessionAgentRemoteLaunch
  },
): SessionAgentLaunchProposal {
  const { profile, remote } = input
  // This machine's profile defaults (model, effort, keys) name its own catalog;
  // the target uses its own defaults unless the agent asked for a model.
  const { cwd: _cwd, worktree: _worktree, apiProviderId: _apiProviderId, ...config } = {
    permissionMode: 'default' as const,
    sandboxMode: 'off' as const,
    ...launch.config,
  }
  return {
    launchId: input.launchId,
    mode: 'spawn',
    agentId: profile.id,
    summary: input.summary,
    name: input.name,
    role: input.role,
    config: {
      ...config,
      // The branch name an agent picked still names the child's branch there.
      ...(launch.config?.worktree?.branchName ? { worktree: { enabled: true, baseBranch: remote.baseRef, mode: 'branch', branchName: launch.config.worktree.branchName } } : {}),
      name: input.name,
      role: input.role,
      remote,
    },
  }
}


function createGrants(parentSessionId: string, launches: SessionAgentLaunchProposal[]): ApprovedLaunch[] {
  assertLaunchCount(launches.length)
  const launchIds = new Set(launches.map((launch) => launch.launchId))
  if (launchIds.size !== launches.length) throw new Error('Every confirmed launch must have a unique launchId')
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  const grants = store()
  return grants.transaction(() => launches.map((launch) => {
    if (resolveLaunchMode(launch.mode) === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (peerSessionId && !getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(peerSessionId)) {
        throw new Error(`Unknown sessionId for link: ${peerSessionId}`)
      }
      return recordApprovedLaunch(grants, parentSessionId, launch, {}).approved
    }
    const profile = profiles.get(launch.agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${launch.agentId}`)
    // Also covers the confirm UI's provider edit, which reaches here as renderer input.
    assertKnownApiProviderId(launch.config, profile)
    const config = {
      ...launch.config,
      ...(typeof launch.config.fastMode === 'boolean'
        ? { codexServiceTier: resolveCodexServiceTier(launch.agentId, launch.config, profile) }
        : {}),
      // Keys are local to this machine; a remote child uses the target's own binding.
      ...(launch.config.remote ? { apiProviderId: undefined } : {}),
    }
    return recordApprovedLaunch(grants, parentSessionId, launch, config).approved
  }))
}

export async function requestSessionAgents(
  callerSessionId: string,
  args: RequestSessionAgentsArgs,
  host: SessionManager,
  signal?: AbortSignal,
) {
  // Nested spawn collab is not supported: sidebar only renders one parent→children level,
  // and grandchild grants would orphan intermediate sessions in the UI.
  // Link peers may still request (they are not spawn children).
  if (store().isSpawnChild(callerSessionId) || hasExternalParent(callerSessionId)) {
    return toolResult({ status: 'error', message: NESTED_COLLABORATION_UNSUPPORTED }, true)
  }
  const parent = host.getSession(callerSessionId)
  if (!parent) return toolResult({ status: 'error', message: 'Parent session is not available' }, true)
  // Only launches to another machine wait on the network before the confirm card.
  const remotes = args.launches?.some?.((launch) => launch.environment?.trim())
    ? await planRemoteLaunches(args, parent)
    : undefined
  const launches = normalizeLaunches(args, parent, remotes)
  let outcome: Awaited<ReturnType<typeof openSessionAgentsConfirm>>
  try {
    outcome = await openSessionAgentsConfirm(parent, { launches, profiles: listSessionAgentProfiles() }, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out|cancelled/i.test(message)) return toolResult({ status: 'cancelled', message })
    throw error
  }
  if (outcome.action === 'cancel') return toolResult({ status: 'cancelled' })
  if (outcome.action === 'decline') {
    return toolResult({ status: 'rejected', feedback: outcome.content?.feedback })
  }
  const confirmed = mergeConfirmedLaunches(launches, outcome.content)
  return toolResult({
    status: 'approved',
    launches: createGrants(callerSessionId, confirmed),
    next: START_APPROVED_LAUNCHES_HINT,
  })
}

/**
 * A mailbox tool call of a spawn child this desktop launched on another
 * machine, arriving as a Host Action from `environmentId`. The child acts on
 * this desktop's mailbox exactly like a local child would.
 */
export async function runRemoteChildMailboxTool(
  environmentId: string | null,
  childSessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const target = remoteChildTarget(childSessionId)
  if (!target || !environmentId || target.environmentId !== environmentId) {
    return toolResult({ status: 'error', message: `${childSessionId} is not a collaboration child launched from here` }, true)
  }
  const { getSessionHost } = await import('../mcp/superone-mcp-server')
  const host = getSessionHost() as SessionManager | null
  if (!host) return toolResult({ status: 'error', message: 'Session host is unavailable' }, true)
  return toolName === 'session_collab_send'
    ? sendSessionMessage(childSessionId, args as unknown as SessionSendArgs, host)
    : retrieveSessionMessages(childSessionId, args as SessionRetrieveArgs, host)
}

/** Spawn children only — link peers must never get a collaboration system prompt. */
export function getSessionCollaborationSystemPrompt(sessionId: string): string | undefined {
  const grant = store().spawnGrantForChild(sessionId)
  return grant ? collaborationSystemPrompt(grant.parent_session_id) : undefined
}

/**
 * Human-approved launch settings for a spawned collaboration child, re-applied on
 * every resume because the child is agent-owned.
 *
 * Spawn children only. A handoff sibling is a normal top-level session the user
 * owns after the first turn: the approved permission/sandbox settings are applied
 * once at creation, and whatever the user picks afterwards wins on resume.
 */
export function getSessionCollaborationRunConfig(
  sessionId: string,
): SessionCollaborationRunConfig | null {
  const row = store().spawnGrantForChild(sessionId)
  if (!row) return null

  const config = parseConfig(row.config_json)
  const permissionMode = config.permissionMode && EDITABLE_PERMISSION_MODES.has(config.permissionMode)
    ? config.permissionMode
    : undefined
  const sandboxMode = config.sandboxMode && EDITABLE_SANDBOX_MODES.has(config.sandboxMode)
    ? config.sandboxMode
    : undefined
  const hasFastMode = typeof config.fastMode === 'boolean'
  const codexServiceTier = hasFastMode
    ? resolveCodexServiceTier(row.agent_id, config)
    : undefined
  if (!permissionMode && !sandboxMode && !hasFastMode) return null
  return {
    ...(permissionMode ? { permissionMode } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(hasFastMode ? { codexServiceTier } : {}),
  }
}
