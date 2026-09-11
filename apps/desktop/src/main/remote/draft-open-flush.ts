import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

/** A handover barrier: the desktop editor may still have an autosave queued
 * when a phone taps its row. Claim only after those keystrokes are durable. */
export function installDraftOpenFlush(windows: Set<BrowserWindow>): (draftId: string) => Promise<void> {
  const pending = new Map<string, { waiting: Set<number>; finish(error?: string): void }>()
  ipcMain.on(AgentIpcChannels.ENVIRONMENT_DRAFT_OPEN_READY, (event, requestId: string, error?: string) => {
    const request = pending.get(requestId)
    if (!request || !request.waiting.delete(event.sender.id)) return
    if (error || !request.waiting.size) request.finish(error)
  })
  return (draftId) => new Promise<void>((resolve, reject) => {
    const renderers = [...windows].filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed())
    if (!renderers.length) { resolve(); return }
    const requestId = randomUUID()
    const timer = setTimeout(() => finish('Could not save the desktop draft. Please try again.'), 3000)
    const finish = (error?: string) => {
      clearTimeout(timer)
      pending.delete(requestId)
      if (error) reject(new Error(error))
      else resolve()
    }
    pending.set(requestId, { waiting: new Set(renderers.map((win) => win.webContents.id)), finish })
    for (const win of renderers) win.webContents.send(AgentIpcChannels.ENVIRONMENT_PREPARE_DRAFT_OPEN, requestId, draftId)
  })
}
