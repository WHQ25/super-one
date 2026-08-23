/**
 * Register Main IPC for remote Skills / MCP resource APIs.
 *
 * Wired here (not only in main/index.ts) so the product path is complete even
 * when preload has not yet grown dedicated `window.environment` wrappers —
 * the renderer can invoke these channels via `window.electron.ipcRenderer`.
 */

import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { ResourceProvider } from '@superone/shared/environment'

let registered = false

export function isEnvironmentResourceIpcRegistered(): boolean {
  return registered
}

/** Idempotent. Safe in unit tests without a real Electron app. */
export function ensureEnvironmentResourceIpcRegistered(): void {
  if (registered) return
  if (typeof ipcMain?.handle !== 'function') return
  registered = true

  const host = async () => {
    const { getEnvironmentHost } = await import('./environment-host')
    return getEnvironmentHost()
  }

  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_SKILLS,
    async (_e, connectionId: string, projectId: string, provider: ResourceProvider) => {
      return (await host()).listRemoteSkills(connectionId, projectId, provider)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_GET_REMOTE_SKILL,
    async (
      _e,
      connectionId: string,
      projectId: string,
      name: string,
      opts?: { sourcePath?: string; provider?: ResourceProvider },
    ) => {
      return (await host()).getRemoteSkill(connectionId, projectId, name, opts)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_READ_REMOTE_SKILL_FILE,
    async (
      _e,
      connectionId: string,
      projectId: string,
      skillName: string,
      relativePath: string,
      opts?: { sourcePath?: string; provider?: ResourceProvider },
    ) => {
      return (await host()).readRemoteSkillFile(
        connectionId,
        projectId,
        skillName,
        relativePath,
        opts,
      )
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DELETE_REMOTE_SKILL,
    async (
      _e,
      connectionId: string,
      projectId: string,
      sourcePath: string,
      provider: ResourceProvider,
    ) => {
      return (await host()).deleteRemoteSkill(connectionId, projectId, sourcePath, provider)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_INSTALL_REMOTE_SKILL,
    async (
      _e,
      connectionId: string,
      projectId: string,
      input: {
        scope: 'user' | 'project'
        name: string
        files: Record<string, string>
        provider?: ResourceProvider
      },
    ) => {
      return (await host()).installRemoteSkill(connectionId, projectId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS,
    async (_e, connectionId: string, projectId: string, provider: ResourceProvider) => {
      return (await host()).listRemoteMcpConfigs(connectionId, projectId, provider)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG,
    async (
      _e,
      connectionId: string,
      projectId: string,
      input: {
        provider: ResourceProvider
        name: string
        scope: 'user' | 'project'
        config: Record<string, unknown>
      },
    ) => {
      return (await host()).saveRemoteMcpConfig(connectionId, projectId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_TOGGLE_REMOTE_MCP_CONFIG,
    async (
      _e,
      connectionId: string,
      projectId: string,
      input: {
        provider: ResourceProvider
        name: string
        scope: 'user' | 'project'
        disabled: boolean
      },
    ) => {
      return (await host()).toggleRemoteMcpConfig(connectionId, projectId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DELETE_REMOTE_MCP_CONFIG,
    async (
      _e,
      connectionId: string,
      projectId: string,
      input: {
        provider: ResourceProvider
        name: string
        scope: 'user' | 'project'
      },
    ) => {
      return (await host()).deleteRemoteMcpConfig(connectionId, projectId, input)
    },
  )


  // --- harness.resources + sessionProviders (node discovery path) ---
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_HARNESS_RESOURCES,
    async (
      _e,
      connectionId: string,
      input: {
        projectId: string
        harnessId?: string
        apiProviderId?: string | null
      },
    ) => {
      return (await host()).getRemoteHarnessResources(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_COLLAB_LIST_PROFILES,
    async (_e, connectionId: string) => {
      return (await host()).listRemoteCollabProfiles(connectionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_LIST,
    async (_e, connectionId: string, harnessId?: string) => {
      return (await host()).listRemoteSessionProviders(connectionId, harnessId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_GET,
    async (_e, connectionId: string, id: string) => {
      return (await host()).getRemoteSessionProvider(connectionId, id)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_GET_BASE,
    async (_e, connectionId: string, harnessId: string) => {
      return (await host()).getRemoteSessionProviderBase(connectionId, harnessId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_CREATE,
    async (
      _e,
      connectionId: string,
      input: { harnessId: string; name: string; config?: unknown; id?: string },
    ) => {
      return (await host()).createRemoteSessionProvider(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_UPDATE,
    async (
      _e,
      connectionId: string,
      id: string,
      patch: { name?: string; config?: unknown },
    ) => {
      return (await host()).updateRemoteSessionProvider(connectionId, id, patch)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_DELETE,
    async (_e, connectionId: string, id: string) => {
      return (await host()).deleteRemoteSessionProvider(connectionId, id)
    },
  )
}

/** Test-only: allow re-registration after mocks are installed. */
export function resetEnvironmentResourceIpcForTests(): void {
  registered = false
}
