import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import log from '../logger'

/**
 * The trackpad's two-finger twist, forwarded to whichever device panel is under it.
 *
 * A HOST gesture rather than a device one — it is the same event whether a simulator
 * or a phone is on screen, and the panel turns it into synthesised contacts itself.
 * macOS emits it on the BrowserWindow that owns the trackpad interaction, so the
 * forwarding stays window-local and detached renderers do not depend on the mutable
 * mainWindow reference.
 */
export function attachDeviceGestureEvents(
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return

  let rotating = false
  win.on('rotate-gesture', (_event, rotation) => {
    if (!Number.isFinite(rotation) || win.isDestroyed()) return

    if (!rotating && rotation !== 0) {
      rotating = true
      log.debug('[device] native rotation started window=%d', win.id)
    } else if (rotating && rotation === 0) {
      rotating = false
      log.debug('[device] native rotation ended window=%d', win.id)
    }

    win.webContents.send(
      AgentIpcChannels.ENVIRONMENT_DEVICE_ROTATE_GESTURE,
      rotation,
    )
  })
}
