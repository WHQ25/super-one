import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import log from '../logger'

/**
 * macOS rotation gestures are emitted by the BrowserWindow that owns the
 * trackpad interaction. Keep forwarding window-local so detached renderers do
 * not depend on the mutable mainWindow reference.
 */
export function attachIosSimulatorGestureEvents(
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return

  let rotating = false
  win.on('rotate-gesture', (_event, rotation) => {
    if (!Number.isFinite(rotation) || win.isDestroyed()) return

    if (!rotating && rotation !== 0) {
      rotating = true
      log.debug('[ios-simulator] native rotation started window=%d', win.id)
    } else if (rotating && rotation === 0) {
      rotating = false
      log.debug('[ios-simulator] native rotation ended window=%d', win.id)
    }

    win.webContents.send(
      AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE,
      rotation,
    )
  })
}
