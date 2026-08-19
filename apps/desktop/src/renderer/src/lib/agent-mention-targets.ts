/**
 * `@codex` / `@grok` targets for the composer, per project.
 *
 * Local: desktop `session_providers` filtered to usable harnesses (main).
 * Remote: the node's own collaboration profiles — a remote session's
 * `session_collab_request` validates `agentId` against the NODE's provider
 * rows, so offering the desktop's list there would produce
 * "Unknown agent profile" on launch.
 */

import { AgentIpcChannels, type AgentMentionTarget, type HarnessId } from '@superone/shared/agent-types'
import { buildAgentMentionTargets } from '@superone/shared/agent-mention-tags'
import { parseRemoteProjectKey } from './remote-project-key'

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function getIpcInvoke(): IpcInvoke | null {
  if (typeof window === 'undefined') return null
  const electron = (window as unknown as { electron?: { ipcRenderer?: { invoke?: IpcInvoke } } })
    .electron
  const invoke = electron?.ipcRenderer?.invoke
  return typeof invoke === 'function' ? invoke.bind(electron!.ipcRenderer) : null
}

/** Injectable surfaces (tests / partial preload). */
export interface AgentMentionTargetApis {
  localList?: () => Promise<unknown>
  remoteCollabProfiles?: (connectionId: string) => Promise<unknown>
}

function localApi(override?: AgentMentionTargetApis): (() => Promise<unknown>) | null {
  if (override?.localList) return override.localList
  const app = (typeof window !== 'undefined'
    ? (window as unknown as {
        app?: { sessionProviders?: { listMentionTargets?: () => Promise<unknown> } }
      }).app
    : undefined)
  const fn = app?.sessionProviders?.listMentionTargets
  return typeof fn === 'function' ? fn.bind(app!.sessionProviders) : null
}

function envCollabProfiles(): ((connectionId: string) => Promise<unknown>) | null {
  const env = (typeof window !== 'undefined'
    ? (window as unknown as {
        environment?: { listRemoteCollabProfiles?: (connectionId: string) => Promise<unknown> }
      }).environment
    : undefined)
  const fn = env?.listRemoteCollabProfiles
  return typeof fn === 'function' ? fn.bind(env!) : null
}

function asTargets(raw: unknown): AgentMentionTarget[] {
  return Array.isArray(raw) ? (raw as AgentMentionTarget[]) : []
}

/**
 * Node profiles are `SessionAgentProfile`, not mention targets. They are the
 * authoritative agentIds for that node, so derive slugs/brand from them with
 * the same shared builder the desktop path uses.
 */
function profilesToTargets(raw: unknown): AgentMentionTarget[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { agents?: unknown } | null)?.agents)
      ? (raw as { agents: unknown[] }).agents
      : Array.isArray((raw as { profiles?: unknown } | null)?.profiles)
        ? (raw as { profiles: unknown[] }).profiles
        : []
  const rows = list.flatMap((entry) => {
    const profile = entry as {
      id?: unknown
      name?: unknown
      harnessId?: unknown
      acpAgentId?: unknown
    }
    if (typeof profile.id !== 'string' || typeof profile.harnessId !== 'string') return []
    // Nodes older than the alias cleanup list each base row twice: once as
    // `claude-base`, once under the bare harness id for legacy tool callers.
    // Current nodes only accept the bare form, they no longer advertise it.
    if (profile.id === profile.harnessId) return []
    return [{
      providerId: profile.id,
      harnessId: profile.harnessId as HarnessId,
      name: typeof profile.name === 'string' ? profile.name : profile.id,
      isBase: profile.id === `${profile.harnessId}-base`,
      acpAgentId: typeof profile.acpAgentId === 'string' ? profile.acpAgentId : null,
    }]
  })
  return buildAgentMentionTargets(rows)
}

export async function listAgentMentionTargets(
  projectPath: string | null | undefined,
  apis?: AgentMentionTargetApis,
): Promise<AgentMentionTarget[]> {
  const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
  try {
    if (!remote) {
      const list = localApi(apis)
      return list ? asTargets(await list()) : []
    }
    const remoteList = apis?.remoteCollabProfiles ?? envCollabProfiles()
    if (remoteList) return profilesToTargets(await remoteList(remote.connectionId))
    // Fall back to raw IPC when the preload wrapper is missing (same pattern as
    // remote-session-providers / remote-resource-ops).
    const invoke = getIpcInvoke()
    if (!invoke) return []
    return profilesToTargets(
      await invoke(AgentIpcChannels.ENVIRONMENT_COLLAB_LIST_PROFILES, remote.connectionId),
    )
  } catch {
    return []
  }
}
