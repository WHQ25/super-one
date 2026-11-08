import { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { deleteSpeechCache } from './cache'

/** Drop saved read-aloud audio and tell open windows so Play Saved does not outlive the files. */
export async function clearSpeechCache(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0) return
  await deleteSpeechCache(messageIds)
  const windows = typeof BrowserWindow.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []
  const ids = [...messageIds]
  for (const win of windows) {
    if (win.isDestroyed()) continue
    win.webContents.send(AgentIpcChannels.SPEECH_CACHE_CLEARED, ids)
  }
}
