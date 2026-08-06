/**
 * Session-layer provider profiles (session_providers) for local vs remote projects.
 *
 * Local: window.app.sessionProviders (desktop session-provider-repo).
 * Remote: window.environment.*RemoteSessionProvider* → node sessionProviders.* RPC
 * (not the desktop SQLite repo).
 *
 * Prefer dedicated environment preload wrappers; fall back to ENVIRONMENT_* IPC
 * when wrappers are missing (same pattern as remote-resource-ops / harness resources).
 */

import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { NodeSessionProvider } from '@superone/shared/environment'
import { parseRemoteProjectKey } from './remote-project-key'

export type SessionProviderHarnessId = 'claude' | 'codex' | 'acp' | 'opencode'

export type SessionProviderProfile = NodeSessionProvider

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function getIpcInvoke(): IpcInvoke | null {
  if (typeof window === 'undefined') return null
  const electron = (window as unknown as { electron?: { ipcRenderer?: { invoke?: IpcInvoke } } })
    .electron
  const invoke = electron?.ipcRenderer?.invoke
  return typeof invoke === 'function' ? invoke.bind(electron!.ipcRenderer) : null
}

function asProviders(raw: unknown): SessionProviderProfile[] {
  if (Array.isArray(raw)) return raw as SessionProviderProfile[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { providers?: unknown }).providers)) {
    return (raw as { providers: SessionProviderProfile[] }).providers
  }
  return []
}

function asProvider(raw: unknown): SessionProviderProfile | null {
  if (!raw || typeof raw !== 'object') return null
  if ('provider' in raw) {
    const p = (raw as { provider: unknown }).provider
    return p && typeof p === 'object' ? (p as SessionProviderProfile) : null
  }
  if ('id' in raw && 'harnessId' in raw) return raw as SessionProviderProfile
  return null
}

/** Injectable environment surface (tests / partial preload). */
export interface RemoteSessionProviderEnvironmentApi {
  listRemoteSessionProviders?(
    connectionId: string,
    harnessId?: string,
  ): Promise<unknown>
  getRemoteSessionProvider?(connectionId: string, id: string): Promise<unknown>
  getRemoteSessionProviderBase?(connectionId: string, harnessId: string): Promise<unknown>
  createRemoteSessionProvider?(
    connectionId: string,
    input: { harnessId: string; name: string; config?: unknown; id?: string },
  ): Promise<unknown>
  updateRemoteSessionProvider?(
    connectionId: string,
    id: string,
    patch: { name?: string; config?: unknown },
  ): Promise<unknown>
  deleteRemoteSessionProvider?(connectionId: string, id: string): Promise<unknown>
}

function envApi(
  override?: RemoteSessionProviderEnvironmentApi | null,
): RemoteSessionProviderEnvironmentApi {
  if (override) return override
  return (
    (typeof window !== 'undefined'
      ? (window as unknown as { environment?: RemoteSessionProviderEnvironmentApi }).environment
      : undefined) ?? {}
  )
}

function localAppApi(): {
  list?: () => Promise<unknown>
  listByHarness?: (harnessId: string) => Promise<unknown>
  get?: (id: string) => Promise<unknown>
  getBase?: (harnessId: string) => Promise<unknown>
  create?: (input: {
    harnessId: string
    name: string
    config?: unknown
    id?: string
  }) => Promise<unknown>
  update?: (id: string, patch: { name?: string; config?: unknown }) => Promise<unknown>
  delete?: (id: string) => Promise<unknown>
} {
  return (
    (typeof window !== 'undefined'
      ? (window as unknown as { app?: { sessionProviders?: ReturnType<typeof localAppApi> } }).app
          ?.sessionProviders
      : undefined) ?? {}
  )
}

/**
 * List session provider profiles for a project path.
 * Remote paths hit the node; local paths hit desktop session-provider-repo.
 */
export async function listSessionProvidersForProject(
  projectPath: string,
  opts?: {
    harnessId?: SessionProviderHarnessId | string
    env?: RemoteSessionProviderEnvironmentApi | null
  },
): Promise<SessionProviderProfile[]> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    const app = localAppApi()
    if (opts?.harnessId && typeof app.listByHarness === 'function') {
      return asProviders(await app.listByHarness(opts.harnessId))
    }
    if (typeof app.list === 'function') return asProviders(await app.list())
    return []
  }

  const env = envApi(opts?.env)
  try {
    let raw: unknown
    if (typeof env.listRemoteSessionProviders === 'function') {
      raw = await env.listRemoteSessionProviders(remote.connectionId, opts?.harnessId)
    } else {
      const invoke = getIpcInvoke()
      if (!invoke) return []
      raw = await invoke(
        AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_LIST,
        remote.connectionId,
        opts?.harnessId,
      )
    }
    return asProviders(raw)
  } catch {
    return []
  }
}

export async function getSessionProviderForProject(
  projectPath: string,
  id: string,
  opts?: { env?: RemoteSessionProviderEnvironmentApi | null },
): Promise<SessionProviderProfile | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    const app = localAppApi()
    if (typeof app.get !== 'function') return null
    return asProvider(await app.get(id))
  }
  const env = envApi(opts?.env)
  try {
    let raw: unknown
    if (typeof env.getRemoteSessionProvider === 'function') {
      raw = await env.getRemoteSessionProvider(remote.connectionId, id)
    } else {
      const invoke = getIpcInvoke()
      if (!invoke) return null
      raw = await invoke(
        AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_GET,
        remote.connectionId,
        id,
      )
    }
    return asProvider(raw)
  } catch {
    return null
  }
}

export async function createSessionProviderForProject(
  projectPath: string,
  input: { harnessId: string; name: string; config?: unknown; id?: string },
  opts?: { env?: RemoteSessionProviderEnvironmentApi | null },
): Promise<SessionProviderProfile | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    const app = localAppApi()
    if (typeof app.create !== 'function') return null
    return asProvider(await app.create(input))
  }
  const env = envApi(opts?.env)
  try {
    let raw: unknown
    if (typeof env.createRemoteSessionProvider === 'function') {
      raw = await env.createRemoteSessionProvider(remote.connectionId, input)
    } else {
      const invoke = getIpcInvoke()
      if (!invoke) return null
      raw = await invoke(
        AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_CREATE,
        remote.connectionId,
        input,
      )
    }
    return asProvider(raw)
  } catch {
    return null
  }
}

export async function updateSessionProviderForProject(
  projectPath: string,
  id: string,
  patch: { name?: string; config?: unknown },
  opts?: { env?: RemoteSessionProviderEnvironmentApi | null },
): Promise<SessionProviderProfile | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    const app = localAppApi()
    if (typeof app.update !== 'function') return null
    return asProvider(await app.update(id, patch))
  }
  const env = envApi(opts?.env)
  try {
    let raw: unknown
    if (typeof env.updateRemoteSessionProvider === 'function') {
      raw = await env.updateRemoteSessionProvider(remote.connectionId, id, patch)
    } else {
      const invoke = getIpcInvoke()
      if (!invoke) return null
      raw = await invoke(
        AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_UPDATE,
        remote.connectionId,
        id,
        patch,
      )
    }
    return asProvider(raw)
  } catch {
    return null
  }
}

export async function deleteSessionProviderForProject(
  projectPath: string,
  id: string,
  opts?: { env?: RemoteSessionProviderEnvironmentApi | null },
): Promise<boolean> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    const app = localAppApi()
    if (typeof app.delete !== 'function') return false
    return Boolean(await app.delete(id))
  }
  const env = envApi(opts?.env)
  try {
    if (typeof env.deleteRemoteSessionProvider === 'function') {
      await env.deleteRemoteSessionProvider(remote.connectionId, id)
      return true
    }
    const invoke = getIpcInvoke()
    if (!invoke) return false
    await invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_DELETE,
      remote.connectionId,
      id,
    )
    return true
  } catch {
    return false
  }
}
