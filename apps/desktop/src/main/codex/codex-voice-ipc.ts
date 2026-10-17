import { app, ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { CodexExperimentService } from './codex-experiment-service'

export function registerCodexVoiceIpc(service: CodexExperimentService): void {
  ipcMain.handle(AgentIpcChannels.CODEX_LIST_REALTIME_VOICES, async (_event, projectPath?: string | null) => {
    const localProjectPath = projectPath && !parseRemoteProjectKey(projectPath)
      ? projectPath
      : app.getPath('userData')
    return service.listRealtimeVoices(localProjectPath)
  })
  ipcMain.handle(AgentIpcChannels.CODEX_LIST_REALTIME_VOICE_PREVIEWS, async (_event, language?: unknown) => {
    const { listCodexVoicePreviews } = await import('./codex-voice-previews')
    return listCodexVoicePreviews(language === 'zh' ? 'zh' : 'en')
  })
}
