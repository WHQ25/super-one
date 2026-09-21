/**
 * The host's own windows, for a drag whose drop point one of them covers.
 *
 * A drop goes to the frontmost window at the drop point, and the window most
 * often over a background target is SuperOne's own. Its order is the one the
 * host can change without activating anything: a window at a level below
 * normal sits under every ordinary window while the app stays active and its
 * key window and keyboard focus stay where they are (§11.8). `lower` takes
 * the windows by the number the window server lists them under and returns
 * the way back to normal.
 */
import type { ComputerAdapterOptions } from './computer-page'

export function ownWindows(): NonNullable<ComputerAdapterOptions['ownWindows']> {
  return {
    pid: process.pid,
    lower(windowIds) {
      const { BrowserWindow } = require('electron') as typeof import('electron')
      // A window already kept on top has an order of its own; it is left alone.
      const lowered = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !win.isAlwaysOnTop() && windowIds.includes(windowNumber(win)))
      for (const win of lowered) win.setAlwaysOnTop(true, 'normal', -1)
      return () => {
        for (const win of lowered) if (!win.isDestroyed()) win.setAlwaysOnTop(false)
      }
    },
  }
}

/** `getMediaSourceId()` reads `window:<CGWindowID>:0`. */
function windowNumber(win: import('electron').BrowserWindow): number {
  return Number(win.getMediaSourceId().split(':')[1])
}
