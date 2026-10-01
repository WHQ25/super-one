import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import log from '../logger'

/** Session-owned preview operations; native capture loads only when requested. */
export function registerComputerUseViewfinderIpc(): void {
  // The push channel also serves a read-only snapshot for late subscribers.
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_CLAIM, async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    const { getComputerUseViewfinderTarget } = await import('./viewfinder')
    return getComputerUseViewfinderTarget(sessionId)
  })
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_VIEWFINDER_FOCUS,
    async (_event, sessionId: string) => {
      if (process.platform !== 'darwin' || typeof sessionId !== 'string' || !sessionId) return false
      try {
        const [{ getComputerUseViewfinderTarget }, { getSharedHelperClient }] = await Promise.all([
          import('./viewfinder'),
          import('./platform/macos-helper-client'),
        ])
        const target = getComputerUseViewfinderTarget(sessionId)
        if (typeof target?.pid !== 'number' || typeof target.windowId !== 'number') return false
        await getSharedHelperClient().call('focus_window', {
          pid: target.pid,
          windowId: target.windowId,
          ...(target.title ? { windowTitle: target.title } : {}),
        })
        return true
      } catch (err) {
        log.warn(
          '[computer-use] focus viewfinder target failed: %s',
          err instanceof Error ? err.message : String(err),
        )
        return false
      }
    },
  )
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_VIEWFINDER_HIDE,
    async (_event, sessionId: string, dismissedWindowId?: number) => {
      if (typeof sessionId !== 'string' || !sessionId) return false
      if (process.platform !== 'darwin') return true
      try {
        const { getSharedHelperClient } = await import('./platform/macos-helper-client')
        await getSharedHelperClient().call('pip_hide', {
          sessionId,
          ...(Number.isInteger(dismissedWindowId) ? { dismissedWindowId } : {}),
        })
        return true
      } catch (err) {
        log.warn(
          '[computer-use] hide viewfinder failed: %s',
          err instanceof Error ? err.message : String(err),
        )
        return false
      }
    },
  )
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_VIEWFINDER_RESTORE,
    async (_event, sessionId: string) => {
      if (process.platform !== 'darwin' || typeof sessionId !== 'string' || !sessionId) return false
      try {
        const [{ getComputerUseViewfinderTarget }, { getSharedHelperClient }] = await Promise.all([
          import('./viewfinder'),
          import('./platform/macos-helper-client'),
        ])
        const target = getComputerUseViewfinderTarget(sessionId)
        if (typeof target?.windowId !== 'number') return false
        const result = await getSharedHelperClient().call<{ shown?: boolean }>('pip_restore', {
          sessionId,
          windowId: target.windowId,
        })
        return result.shown !== false
      } catch (err) {
        log.warn(
          '[computer-use] restore viewfinder failed: %s',
          err instanceof Error ? err.message : String(err),
        )
        return false
      }
    },
  )
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_VIEWFINDER_RESIZE,
    async (
      _event,
      sessionId: string,
      windowId: number,
      width: number,
      height: number,
    ) => {
      if (
        process.platform !== 'darwin'
        || typeof sessionId !== 'string'
        || !sessionId
        || !Number.isInteger(windowId)
        || !Number.isInteger(width)
        || !Number.isInteger(height)
        || width <= 0
        || height <= 0
      ) return false
      try {
        const [{ getComputerUseViewfinderTarget }, { getSharedHelperClient }] = await Promise.all([
          import('./viewfinder'),
          import('./platform/macos-helper-client'),
        ])
        const target = getComputerUseViewfinderTarget(sessionId)
        if (target?.windowId !== windowId) return false
        const result = await getSharedHelperClient().call<{ resized?: boolean }>('pip_resize', {
          sessionId,
          windowId,
          width,
          height,
        })
        return result.resized !== false
      } catch (err) {
        log.warn(
          '[computer-use] resize viewfinder capture failed: %s',
          err instanceof Error ? err.message : String(err),
        )
        return false
      }
    },
  )
}
