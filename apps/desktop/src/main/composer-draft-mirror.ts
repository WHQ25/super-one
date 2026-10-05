import { ipcMain, type BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

export type ComposerDraftPatch = Record<string, unknown>

/**
 * Composer drafts live in each renderer's chat store, so a session open in two
 * windows (the main window and a spawned mini window) would otherwise edit two
 * separate drafts. Main relays each change to the other windows and keeps the
 * merged draft, so a window that opens the session later starts from it.
 */
export function installComposerDraftMirror(windows: Set<BrowserWindow>): { forget(sessionIds: string[]): void } {
  const drafts = new Map<string, ComposerDraftPatch>()
  ipcMain.handle(AgentIpcChannels.COMPOSER_DRAFTS_GET, () => Object.fromEntries(drafts))
  ipcMain.on(AgentIpcChannels.COMPOSER_DRAFT_PUBLISH, (event, sessionId: unknown, patch: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId || !patch || typeof patch !== 'object') return
    drafts.set(sessionId, { ...drafts.get(sessionId), ...patch })
    for (const win of windows) {
      if (win.isDestroyed() || win.webContents.id === event.sender.id) continue
      win.webContents.send(AgentIpcChannels.COMPOSER_DRAFT_CHANGED, sessionId, patch)
    }
  })
  return { forget: (sessionIds) => { for (const id of sessionIds) drafts.delete(id) } }
}
