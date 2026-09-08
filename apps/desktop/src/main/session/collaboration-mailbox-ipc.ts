import { BrowserWindow, ipcMain } from 'electron'
import { COLLABORATION_MAILBOX_CHANNELS } from '@superone/shared/collaboration-mailbox'
import { listUnreadCollaborationMessages, onCollaborationMailboxChanged } from './collaboration-mailbox'

export function registerCollaborationMailboxIpc(): void {
  ipcMain.handle(COLLABORATION_MAILBOX_CHANNELS.list, (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return []
    return listUnreadCollaborationMessages(sessionId)
  })
  onCollaborationMailboxChanged((sessionId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(COLLABORATION_MAILBOX_CHANNELS.changed, sessionId)
    }
  })
}
