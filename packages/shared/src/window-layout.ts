import type { NativeWindowLayoutState } from './layout-session-api'
export type { NativeWindowLayoutState } from './layout-session-api'

/** Native window layout stays scoped to the IPC sender's own window. */
export const WINDOW_LAYOUT_IPC_CHANNELS = {
  GET_FULLSCREEN: 'app:get-fullscreen',
  FULLSCREEN_CHANGED: 'app:fullscreen-changed',
  SET_MIN_WINDOW_SIZE: 'app:set-min-window-size',
  GET_WINDOW_LAYOUT_STATE: 'app:get-window-layout-state',
  RESIZE_WINDOW: 'app:resize-window',
  SET_WINDOW_FULLSCREEN: 'app:set-window-fullscreen',
} as const

export interface WindowResizeRequest { width?: number; height?: number }

export interface WindowLayoutAPI {
  getWindowLayoutState(): Promise<NativeWindowLayoutState>
  resizeWindow(size: WindowResizeRequest): Promise<NativeWindowLayoutState>
  setWindowFullscreen(fullscreen: boolean): Promise<NativeWindowLayoutState>
  getFullscreen(): Promise<boolean>
  onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
  setMinWindowSize(width: number, height: number): Promise<void>
}
