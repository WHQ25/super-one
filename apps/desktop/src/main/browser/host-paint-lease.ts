import type { BrowserWindow, WebContents } from 'electron'
import log from '../logger'

/**
 * Keep the app window compositing while a browser capture runs in it.
 *
 * Chromium stops producing frames for a minimized or fully covered window, and
 * a <webview> guest is composited through that window. In that state the host's
 * requestAnimationFrame never fires and webview.capturePage waits forever for a
 * frame — exactly when an agent works while the user is in another app.
 *
 * Turning background throttling off shows the hidden widget again. Turning it
 * back on does not hide it: the window would keep painting until its next
 * visibility change. So the last release ends with one throwaway capturePage,
 * because Chromium recomputes a page's visibility when its capturer count
 * drops back to zero, hiding a window that is still covered.
 */
const RESTORE_CAPTURE_TIMEOUT_MS = 2_000

const holders = new WeakMap<WebContents, number>()

export async function withHostPainting<T>(win: BrowserWindow, run: () => Promise<T>): Promise<T> {
  const contents = win.webContents
  const held = holders.get(contents) ?? 0
  holders.set(contents, held + 1)
  if (held === 0) contents.setBackgroundThrottling(false)
  try {
    return await run()
  } finally {
    const remaining = (holders.get(contents) ?? 1) - 1
    if (remaining > 0) holders.set(contents, remaining)
    else {
      holders.delete(contents)
      if (!win.isDestroyed()) restoreThrottling(win)
    }
  }
}

function restoreThrottling(win: BrowserWindow): void {
  win.webContents.setBackgroundThrottling(true)
  // A focused window is on screen, so Chromium never hid it.
  if (win.isFocused()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  void Promise.race([
    win.webContents.capturePage(),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, RESTORE_CAPTURE_TIMEOUT_MS) }),
  ])
    .catch((err: unknown) => {
      log.warn('[browser-automation] host visibility refresh failed: %s', err instanceof Error ? err.message : String(err))
    })
    .finally(() => clearTimeout(timer))
}
