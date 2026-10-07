import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'

export function registerSessionLinkIpc(): void {
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_SESSION_SOURCE, async (_event, projectPath: string) => (await import('./session-links')).sessionEnvironmentId(projectPath))
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_SESSION_LINK_METADATA, async (_event, refs: SessionRef[]) => (await import('./session-links')).sessionLinkMetadata(refs))
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_SESSION_LINK_TARGET, async (_event, ref: SessionRef) => (await import('./session-links')).resolveSessionLinkTarget(ref))
}
