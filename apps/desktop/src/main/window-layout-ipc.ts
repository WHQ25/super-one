import { BrowserWindow, ipcMain, screen } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { NativeWindowLayoutState, WindowResizeRequest } from '@superone/shared/window-layout'

const transitions = new WeakSet<BrowserWindow>()

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('The requesting window is unavailable.')
  return win
}

function readState(win: BrowserWindow): NativeWindowLayoutState {
  const bounds = win.getBounds()
  const [width, height] = win.getMinimumSize()
  return { bounds, minSize: { width, height }, workArea: screen.getDisplayMatching(bounds).workArea,
    fullscreen: win.isFullScreen(), maximized: win.isMaximized(), transitioning: transitions.has(win) }
}

function waitForNativeEvent(win: BrowserWindow, event: 'enter-full-screen' | 'leave-full-screen', change: () => void): Promise<void> {
  const events: NodeJS.EventEmitter = win
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      events.removeListener(event, done)
      events.removeListener('closed', closed)
      if (error) reject(error)
      else resolve()
    }
    const done = () => finish()
    const closed = () => finish(new Error('The window closed during the layout change.'))
    const timer = setTimeout(() => finish(new Error('Window layout change timed out. Check layout_snapshot before retrying.')), 10_000)
    events.once(event, done)
    events.once('closed', closed)
    try { change() } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}

async function changeWindow(win: BrowserWindow, change: () => Promise<void>): Promise<NativeWindowLayoutState> {
  if (transitions.has(win)) throw new Error('The window is already changing layout. Check layout_snapshot before retrying.')
  if (!win.isVisible()) throw new Error('The requesting window is not visible.')
  transitions.add(win)
  try { await change() } finally { transitions.delete(win) }
  if (win.isDestroyed()) throw new Error('The requesting window is unavailable.')
  return readState(win)
}

function validateSize(size: WindowResizeRequest): void {
  if (!size || typeof size !== 'object' || (size.width === undefined && size.height === undefined)) throw new Error('resize_window needs width, height, or both.')
  for (const value of [size.width, size.height]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Window dimensions must be positive integers in device-independent pixels.')
  }
}

function resizeBounds(state: NativeWindowLayoutState, size: WindowResizeRequest) {
  const { workArea: work, minSize: min, bounds } = state
  if (min.width > work.width || min.height > work.height) throw new Error('The layout minimum size does not fit the current display work area. Close panels or splits first.')
  const width = Math.min(work.width, Math.max(min.width, size.width ?? bounds.width))
  const height = Math.min(work.height, Math.max(min.height, size.height ?? bounds.height))
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width))
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height))
  return { x, y, width, height }
}

export function registerWindowLayoutIpc(deps: { isMiniWindow: (win: BrowserWindow) => boolean }): void {
  ipcMain.handle(AgentIpcChannels.GET_FULLSCREEN, event => senderWindow(event).isFullScreen())
  ipcMain.handle(AgentIpcChannels.GET_WINDOW_LAYOUT_STATE, event => readState(senderWindow(event)))
  ipcMain.handle(AgentIpcChannels.RESIZE_WINDOW, async (event, size: WindowResizeRequest) => {
    validateSize(size)
    const win = senderWindow(event)
    return changeWindow(win, async () => {
      if (win.isFullScreen()) throw new Error('Use exit_fullscreen before resize_window.')
      let bounds = resizeBounds(readState(win), size)
      if (win.isMaximized()) {
        // macOS also reports manually work-area-sized windows as maximized.
        // unmaximize is then a no-op and emits no event; setBounds still resizes it.
        win.unmaximize()
        bounds = resizeBounds(readState(win), size)
      }
      win.setBounds(bounds, false)
    })
  })
  ipcMain.handle(AgentIpcChannels.SET_WINDOW_FULLSCREEN, async (event, fullscreen: boolean) => {
    if (typeof fullscreen !== 'boolean') throw new Error('fullscreen must be a boolean.')
    const win = senderWindow(event)
    return changeWindow(win, async () => {
      if (fullscreen && deps.isMiniWindow(win)) throw new Error('Use window_mode with mode "full" before enter_fullscreen.')
      if (win.isFullScreen() === fullscreen) return
      await waitForNativeEvent(win, fullscreen ? 'enter-full-screen' : 'leave-full-screen', () => win.setFullScreen(fullscreen))
      if (win.isFullScreen() !== fullscreen) throw new Error('The system did not apply the requested fullscreen state.')
    })
  })

  // Keep layout minimum enforcement with the other sender-scoped window operations.
  ipcMain.handle(AgentIpcChannels.SET_MIN_WINDOW_SIZE, (event, width: number, height: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Window minimum dimensions must be finite.')
    const win = senderWindow(event)
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
    win.setMinimumSize(w, h)
    if (win.isFullScreen() || win.isMaximized() || transitions.has(win)) return
    const [curW, curH] = win.getSize()
    if (curW >= w && curH >= h) return
    const newW = Math.max(curW, w), newH = Math.max(curH, h)
    const work = screen.getDisplayMatching(win.getBounds()).workArea
    let [x, y] = win.getPosition()
    if (x + newW > work.x + work.width) x = Math.max(work.x, work.x + work.width - newW)
    if (y + newH > work.y + work.height) y = Math.max(work.y, work.y + work.height - newH)
    win.setBounds({ x, y, width: newW, height: newH }, true)
  })
}
