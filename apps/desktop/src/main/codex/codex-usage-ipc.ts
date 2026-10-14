import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { CodexExperimentService } from './codex-experiment-service'

export function registerCodexUsageIpc(service: CodexExperimentService): void {
  ipcMain.handle(AgentIpcChannels.CODEX_GET_RATE_LIMITS, async (_event, projectPath: string, apiProviderId?: string | null, force = false, preferCached = false) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetRateLimits } = await import('../environment')
      return remoteCodexGetRateLimits(getEnvironmentHost(), projectPath, apiProviderId ?? null, force, preferCached)
    }
    return service.getRateLimits(projectPath, apiProviderId ?? null, force, preferCached)
  })
  ipcMain.handle(AgentIpcChannels.CODEX_GET_ACCOUNT_USAGE, async (_event, projectPath: string, apiProviderId?: string | null, threadId?: string | null, force = false, preferCached = false) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetAccountUsage } = await import('../environment')
      return remoteCodexGetAccountUsage(getEnvironmentHost(), projectPath, apiProviderId ?? null, threadId ?? null, force, preferCached)
    }
    return service.getAccountUsage(projectPath, apiProviderId ?? null, threadId ?? null, force, preferCached)
  })
}
