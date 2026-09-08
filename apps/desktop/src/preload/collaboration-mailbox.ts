import { ipcRenderer } from 'electron'
import { COLLABORATION_MAILBOX_CHANNELS, type CollaborationMailboxAPI } from '@superone/shared/collaboration-mailbox'

export const collaborationMailbox: CollaborationMailboxAPI = {
  list: (sessionId) => ipcRenderer.invoke(COLLABORATION_MAILBOX_CHANNELS.list, sessionId),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, sessionId: string): void => callback(sessionId)
    ipcRenderer.on(COLLABORATION_MAILBOX_CHANNELS.changed, listener)
    return () => { ipcRenderer.removeListener(COLLABORATION_MAILBOX_CHANNELS.changed, listener) }
  },
}
