import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

let mainWindow: BrowserWindow | null = null

export function setCodexSkillsWatcherWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function notifyCodexSkillsChanged(projectPath: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(AgentIpcChannels.CODEX_SKILLS_CHANGED, { projectPath })
}
