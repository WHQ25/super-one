/**
 * `@codex` / `@grok` targets for the composer, per project.
 *
 * Local: desktop `session_providers` filtered to usable harnesses (main).
 * Remote: the node's own collaboration profiles — a remote session's
 * `session_collab_request` validates `agentId` against the NODE's provider
 * rows, so offering the desktop's list there would produce
 * "Unknown agent profile" on launch.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { isAcpProtocolHarness } from '@superone/shared/acp-brand'
import { AgentIpcChannels, type AgentMentionTarget, type HarnessId } from '@superone/shared/agent-types'
import { buildAgentMentionTargets } from '@superone/shared/agent-mention-tags'
import { parseRemoteProjectKey } from './remote-project-key'

const EMPTY_AGENT_TARGETS: AgentMentionTarget[] = []
const targetsByProject = new Map<string, AgentMentionTarget[]>()
const pendingTargetsByProject = new Map<string, Promise<AgentMentionTarget[]>>()
const latestTargetRequestByProject = new Map<string, number>()
const targetListeners = new Set<() => void>()

const targetCacheKey = (projectPath: string | null | undefined) => projectPath || '__local__'
const subscribeTargets = (callback: () => void) => {
  targetListeners.add(callback)
  return () => {
    targetListeners.delete(callback)
  }
}

function sameAgentTargets(a: readonly AgentMentionTarget[] | undefined, b: readonly AgentMentionTarget[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.ref !== y.ref
      || x.providerId !== y.providerId
      || x.harnessId !== y.harnessId
      || x.slug !== y.slug
      || x.displayName !== y.displayName
      || x.brandKey !== y.brandKey
      || x.isBase !== y.isBase
      || x.aliases.length !== y.aliases.length
    ) {
      return false
    }
    for (let j = 0; j < x.aliases.length; j++) {
      if (x.aliases[j] !== y.aliases[j]) return false
    }
  }
  return true
}

function storeAgentTargets(key: string, targets: AgentMentionTarget[]): void {
  if (sameAgentTargets(targetsByProject.get(key), targets)) return
  targetsByProject.set(key, targets)
  for (const listener of targetListeners) listener()
}

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
      isBase:
        profile.id === `${profile.harnessId}-base`
        // The stored provider row is still `acp-base` after the harness id
        // became `acp-grok` or `acp-antigravity`.
        || profile.id === 'acp-base'
        || isAcpProtocolHarness(profile.id),
      acpAgentId: typeof profile.acpAgentId === 'string' ? profile.acpAgentId : null,
    }]
  })
  return buildAgentMentionTargets(rows)
}

async function fetchAgentMentionTargets(
  projectPath: string | null | undefined,
  apis?: AgentMentionTargetApis,
): Promise<AgentMentionTarget[]> {
  const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
  if (!remote) {
    const list = localApi(apis)
    return list ? asTargets(await list()) : []
  }
  const remoteList = apis?.remoteCollabProfiles ?? envCollabProfiles()
  if (remoteList) return profilesToTargets(await remoteList(remote.connectionId))
  const invoke = getIpcInvoke()
  if (!invoke) return []
  return profilesToTargets(
    await invoke(AgentIpcChannels.ENVIRONMENT_COLLAB_LIST_PROFILES, remote.connectionId),
  )
}

export async function listAgentMentionTargets(
  projectPath: string | null | undefined,
  apis?: AgentMentionTargetApis,
): Promise<AgentMentionTarget[]> {
  try {
    return await fetchAgentMentionTargets(projectPath, apis)
  } catch {
    return []
  }
}

export function loadAgentMentionTargets(
  projectPath: string | null | undefined,
  opts?: { fresh?: boolean },
): Promise<AgentMentionTarget[]> {
  const key = targetCacheKey(projectPath)
  if (!opts?.fresh) {
    const existing = pendingTargetsByProject.get(key)
    if (existing) return existing
  }
  const generation = (latestTargetRequestByProject.get(key) ?? 0) + 1
  latestTargetRequestByProject.set(key, generation)
  const request = fetchAgentMentionTargets(projectPath)
    .then((targets) => {
      if (latestTargetRequestByProject.get(key) === generation) {
        storeAgentTargets(key, targets)
      }
      return targets
    })
    .catch(() => targetsByProject.get(key) ?? EMPTY_AGENT_TARGETS)
    .finally(() => {
      if (pendingTargetsByProject.get(key) === request) pendingTargetsByProject.delete(key)
    })
  pendingTargetsByProject.set(key, request)
  return request
}

export function useAgentMentionTargets(
  projectPath: string | null | undefined,
  refreshKey?: unknown,
): AgentMentionTarget[] {
  const key = targetCacheKey(projectPath)
  const targets = useSyncExternalStore(
    subscribeTargets,
    () => targetsByProject.get(key) ?? EMPTY_AGENT_TARGETS,
  )

  useEffect(() => {
    void loadAgentMentionTargets(projectPath)
  }, [projectPath, refreshKey])

  return targets
}

export function clearAgentMentionTargetsCache(): void {
  targetsByProject.clear()
  pendingTargetsByProject.clear()
  latestTargetRequestByProject.clear()
  for (const listener of targetListeners) listener()
}
