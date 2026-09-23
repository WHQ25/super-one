import { randomUUID } from 'crypto'
import type {
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import {
  EDITABLE_PERMISSION_MODES,
  EDITABLE_SANDBOX_MODES,
  NESTED_COLLABORATION_UNSUPPORTED,
  assertLaunchCount,
  collaborationSessionTitle,
  collaborationSystemPrompt,
  mergeConfirmedLaunches,
  normalizeLaunchText,
  parseGrantConfig as parseConfig,
  resolveLaunchMode,
} from '@superone/runtime/collaboration'
import { getDb } from '../database'
import { listSessionAgentProfiles } from './agent-profiles'
import { collaborationStore as store } from './collaboration-mailbox'
import { defaultLaunchCwd } from './collaboration-child-project'
import { resolveCodexServiceTier, toolResult } from './collaboration-host'
import type { Session, SessionManager } from './types'
import { openSessionAgentsConfirm } from './session-collaboration-confirm'

export { setSessionCollaborationCallbacks } from './collaboration-host'
export { sendSessionMessage, retrieveSessionMessages, type SessionSendArgs, type SessionRetrieveArgs } from './collaboration-messaging'
export { startSessionAgent } from './collaboration-start'

/**
 * Agent-profile listing moved to ./agent-profiles when this file passed 1600
 * lines. Re-exported here so existing importers keep resolving it from the
 * collaboration module.
 */
export { listSessionAgentProfiles } from './agent-profiles'

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
    /** Short confirm-UI description. Optional for spawn/handoff when task is present. */
    summary?: string
    /** Spawn/handoff: full task. Link: optional opening for the peer. */
    task?: string
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

function normalizeLaunches(args: RequestSessionAgentsArgs, parent: Session): SessionAgentLaunchProposal[] {
  if (!Array.isArray(args.launches)) throw new Error('launches must contain at least one proposed session')
  assertLaunchCount(args.launches.length)
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  return args.launches.map((launch) => {
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
      const peerTitle = peerRow.title?.trim() || peerSessionId.slice(0, 8)
      const { summary, task, name, role } = normalizeLaunchText('link', launch, peerTitle)
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
        task,
        name,
        role,
        config: { name, role, summary },
      }
    }

    // spawn + handoff share the whole launch shape; they differ only in whether the
    // new session is nested under the initiator and gets a mailbox credential.
    const agentId = launch.agentId?.trim()
    if (!agentId) throw new Error(`${mode} launches require agentId from session_collab_list_agents`)
    const profile = profiles.get(agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${agentId}`)
    assertKnownApiProviderId(launch.config, profile)
    const { summary, task, name, role } = normalizeLaunchText(mode, launch)
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


function createGrants(parentSessionId: string, launches: SessionAgentLaunchProposal[]) {
  assertLaunchCount(launches.length)
  const launchIds = new Set(launches.map((launch) => launch.launchId))
  if (launchIds.size !== launches.length) throw new Error('Every confirmed launch must have a unique launchId')
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  const grants = store()
  return grants.transaction(() => launches.map((launch) => {
    const mode = resolveLaunchMode(launch.mode)
    const { summary, name, role } = launch

    if (mode === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (!peerSessionId) throw new Error('Link launches require sessionId')
      // Reuse an existing initiator→peer link grant (idempotent re-approve).
      const existing = grants.findLinkGrant(parentSessionId, peerSessionId)
      const existingCredential = existing ? grants.credentialOf(existing) : null
      if (existing && existingCredential) {
        return {
          launchId: launch.launchId,
          mode: 'link' as const,
          agentId: existing.agent_id,
          sessionId: peerSessionId,
          peerSessionId,
          summary,
          task: existing.task,
          name,
          role,
          title: collaborationSessionTitle(name, role),
          config: parseConfig(existing.config_json),
          credential: existingCredential,
          reused: true,
        }
      }
      const peerExists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(peerSessionId)
      if (!peerExists) throw new Error(`Unknown sessionId for link: ${peerSessionId}`)
      // Opening is optional: empty task means wake-only (no mailbox opening body).
      const task = (launch.task ?? '').trim()
      const config = {
        name,
        role,
        summary,
        peerSessionId,
        peerTitle: launch.peerTitle,
        peerProjectPath: launch.peerProjectPath,
      }
      const { credential } = grants.createGrant({
        kind: 'link',
        parentSessionId,
        childSessionId: peerSessionId,
        agentId: '',
        task,
        config,
      })
      return {
        launchId: launch.launchId,
        mode: 'link' as const,
        agentId: '',
        sessionId: peerSessionId,
        peerSessionId,
        summary,
        task,
        name,
        role,
        title: collaborationSessionTitle(name, role),
        config,
        credential,
        reused: false,
      }
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
      name,
      role,
      summary,
    }
    const { credential } = grants.createGrant({
      kind: mode,
      parentSessionId,
      agentId: launch.agentId,
      task: launch.task,
      config,
    })
    return {
      launchId: launch.launchId,
      mode,
      agentId: launch.agentId,
      summary,
      task: launch.task,
      name,
      role,
      title: collaborationSessionTitle(name, role),
      config,
      credential,
      reused: false,
    }
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
  if (store().isSpawnChild(callerSessionId)) {
    return toolResult({ status: 'error', message: NESTED_COLLABORATION_UNSUPPORTED }, true)
  }
  const parent = host.getSession(callerSessionId)
  if (!parent) return toolResult({ status: 'error', message: 'Parent session is not available' }, true)
  const launches = normalizeLaunches(args, parent)
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
  const credentials = createGrants(callerSessionId, confirmed)
  return toolResult({ status: 'approved', launches: credentials })
}

/** Spawn children only — link peers must never get system-prompt credential injection. */
export function getSessionCollaborationSystemPrompt(sessionId: string): string | undefined {
  const grants = store()
  const grant = grants.spawnGrantForChild(sessionId)
  const credential = grant ? grants.credentialOf(grant) : null
  return grant && credential ? collaborationSystemPrompt(credential, grant.parent_session_id) : undefined
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
