/**
 * Fetch node harness.resources for a remote project (no desktop CONNECT_* cache).
 * Prefers window.environment when wrapped; falls back to electron IPC channels
 * registered from apps/desktop environment-resource-ipc.
 */

import { AgentIpcChannels } from '@superone/shared/agent-types'
import type {
  ClaudeResources,
  CodexResources,
  ModelOption,
  OpenCodeResources,
} from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from './remote-project-key'

export interface RemoteHarnessResourcesBundle {
  claude?: ClaudeResources | null
  codex?: CodexResources | null
  opencode?: OpenCodeResources | null
}

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function getIpcInvoke(): IpcInvoke | null {
  if (typeof window === 'undefined') return null
  const electron = (window as unknown as { electron?: { ipcRenderer?: { invoke?: IpcInvoke } } })
    .electron
  const invoke = electron?.ipcRenderer?.invoke
  return typeof invoke === 'function' ? invoke.bind(electron!.ipcRenderer) : null
}

async function resolveRemoteProjectId(
  connectionId: string,
  hostPath: string,
): Promise<string | null> {
  const env = (window as unknown as { environment?: {
    listProjects?: (id: string, opts?: { refresh?: boolean }) => Promise<Array<{ projectId: string; path: string }>>
    openProject?: (id: string, path: string, opts?: { createIfMissing?: boolean }) => Promise<{ projectId: string }>
  } }).environment
  try {
    const listed = (await env?.listProjects?.(connectionId, { refresh: false })) ?? []
    const hit = listed.find((p) => p.path === hostPath)
    if (hit?.projectId) return hit.projectId
    const opened = await env?.openProject?.(connectionId, hostPath, { createIfMissing: true })
    return opened?.projectId ?? null
  } catch {
    return null
  }
}

/**
 * Call harness.resources on the node for a remote project key.
 * Returns null when path is local or project cannot be resolved.
 */
export async function fetchRemoteHarnessResourcesForProject(
  projectPath: string,
  opts?: { harnessId?: string; apiProviderId?: string | null },
): Promise<RemoteHarnessResourcesBundle | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) return null

  const env = (window as unknown as {
    environment?: {
      getRemoteHarnessResources?: (
        connectionId: string,
        input: { projectId: string; harnessId?: string; apiProviderId?: string | null },
      ) => Promise<unknown>
    }
  }).environment

  const projectId = await resolveRemoteProjectId(remote.connectionId, remote.path)
  if (!projectId) return null

  const input = {
    projectId,
    harnessId: opts?.harnessId,
    apiProviderId: opts?.apiProviderId ?? null,
  }

  try {
    // Primary path: preload window.environment.getRemoteHarnessResources
    // (EnvironmentHost → RemoteEnvironmentGateway.harnessResources).
    // Fallback: raw ENVIRONMENT_HARNESS_RESOURCES IPC when preload is outdated.
    let raw: unknown
    if (typeof env?.getRemoteHarnessResources === 'function') {
      raw = await env.getRemoteHarnessResources(remote.connectionId, input)
    } else {
      const invoke = getIpcInvoke()
      if (!invoke) {
        // Missing preload + no electron bridge → cannot silently succeed with null
        // without a channel; surface as null so session-lifecycle can fall back
        // to listSlashResources / listRemoteModels.
        return null
      }
      raw = await invoke(
        AgentIpcChannels.ENVIRONMENT_HARNESS_RESOURCES,
        remote.connectionId,
        input,
      )
    }
    if (!raw || typeof raw !== 'object') return null
    return raw as RemoteHarnessResourcesBundle
  } catch (err) {
    // Callers treat null as "node discovery unavailable" and quietly fall back
    // to the stale slug table, so an RPC timeout here is otherwise invisible.
    console.warn('[remote-harness-resources] harness.resources failed', err)
    return null
  }
}

/** Apply claude section of harness.resources into project model catalogs. */
export function extractClaudeModels(bundle: RemoteHarnessResourcesBundle | null): ModelOption[] {
  const models = bundle?.claude?.models
  return Array.isArray(models) ? models : []
}

export function extractCodexModels(bundle: RemoteHarnessResourcesBundle | null): ModelOption[] {
  const models = bundle?.codex?.models
  return Array.isArray(models) ? models : []
}
