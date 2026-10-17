import { ipcRenderer } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { WindowLayoutAPI } from '@superone/shared/window-layout'

export const windowLayoutAPI: WindowLayoutAPI = {
  getWindowLayoutState: () => ipcRenderer.invoke(AgentIpcChannels.GET_WINDOW_LAYOUT_STATE),
  resizeWindow: size => ipcRenderer.invoke(AgentIpcChannels.RESIZE_WINDOW, size),
  setWindowFullscreen: fullscreen => ipcRenderer.invoke(AgentIpcChannels.SET_WINDOW_FULLSCREEN, fullscreen),
  getFullscreen: () => ipcRenderer.invoke(AgentIpcChannels.GET_FULLSCREEN),
  onFullscreenChanged: callback => {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => callback(fullscreen)
    ipcRenderer.on(AgentIpcChannels.FULLSCREEN_CHANGED, handler)
    return () => { ipcRenderer.removeListener(AgentIpcChannels.FULLSCREEN_CHANGED, handler) }
  },
  setMinWindowSize: (width, height) => ipcRenderer.invoke(AgentIpcChannels.SET_MIN_WINDOW_SIZE, width, height),
}
