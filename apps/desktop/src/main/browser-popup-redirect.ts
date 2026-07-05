import { app, ipcMain, session, webContents } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { isCdpEnabled } from './browser/browser-cdp'
import { enableNetworkCapture } from './browser/browser-cdp-network'
import log from './logger'

const BROWSER_PARTITION = 'persist:browser'

function isBrowserWebview(wc: Electron.WebContents): boolean {
  return wc.getType() === 'webview' && wc.session === session.fromPartition(BROWSER_PARTITION)
}

// Turned on when CDP is toggled on at runtime: attach + Network.enable to every
// already-open browser tab so their traffic is captured without a reload.
export function enableCdpCaptureForExistingBrowserTabs(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (isBrowserWebview(wc)) {
      void enableNetworkCapture(wc.id).catch((err) => log.warn('[browser-cdp] backfill capture failed: %s', err instanceof Error ? err.message : String(err)))
    }
  }
}

const allowedCertHosts = new Set<string>()

function certHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

// The built-in browser <webview> allows popups (required for window.open to reach
// this handler at all). Cmd/Ctrl+click and target=_blank (tab dispositions) route to
// a real browser tab; feature'd window.open popups (disposition 'new-window', the
// OAuth signature) open as a real popup window so window.opener and the window ref
// returned to the opener survive — postMessage-relay logins (Google Identity Services
// on x.com, etc.) break with a same-tab redirect because the opener chain is severed.
export function registerBrowserPopupRedirect(): void {
  ipcMain.handle(AgentIpcChannels.BROWSER_CERT_PROCEED, (_e, url: string) => {
    const host = certHost(url)
    if (host) allowedCertHosts.add(host)
  })

  app.on('web-contents-created', (_event, contents) => {
    if (!isBrowserWebview(contents)) return

    if (isCdpEnabled()) {
      void enableNetworkCapture(contents.id).catch((err) => log.warn('[browser-cdp] capture attach failed: %s', err instanceof Error ? err.message : String(err)))
    }

    contents.on('certificate-error', (event, url, error, _certificate, callback) => {
      const host = certHost(url)
      if (host && allowedCertHosts.has(host)) {
        event.preventDefault()
        callback(true)
        return
      }
      contents.hostWebContents?.send(AgentIpcChannels.BROWSER_CERT_ERROR, { webContentsId: contents.id, url, error })
    })

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!url || url === 'about:blank') return { action: 'deny' }
      // Chrome maps Cmd/Ctrl+click → 'background-tab', Cmd/Ctrl+Shift+click and
      // target=_blank → 'foreground-tab'. Route those to a real new browser tab.
      if (disposition === 'foreground-tab' || disposition === 'background-tab') {
        contents.hostWebContents?.send(AgentIpcChannels.BROWSER_OPEN_TAB, {
          webContentsId: contents.id,
          url,
          background: disposition === 'background-tab',
        })
        return { action: 'deny' }
      }
      // Feature'd window.open (disposition 'new-window') → real popup window. Allow it
      // so the opener keeps a live window ref and the popup keeps window.opener, which
      // postMessage-relay OAuth (Google Identity Services) depends on. The popup inherits
      // the opener's session/partition, so browser cookies are shared automatically.
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    })

    // Keyboard events inside the guest webview never bubble to the host renderer,
    // so the "enter annotate mode" shortcut (Cmd/Ctrl+.) must be intercepted here.
    // Forward the guest's webContents id so the host can route it to the right tab.
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = process.platform === 'darwin' ? input.meta : input.control
      if (!mod || input.shift || input.alt) return
      if (input.key === '.') {
        event.preventDefault()
        contents.hostWebContents?.send(AgentIpcChannels.BROWSER_ANNOTATE_SHORTCUT, contents.id)
      } else if (input.key.toLowerCase() === 'd') {
        event.preventDefault()
        contents.hostWebContents?.send(AgentIpcChannels.BROWSER_BOOKMARK_SHORTCUT, contents.id)
      } else if (input.key.toLowerCase() === 't') {
        event.preventDefault()
        contents.hostWebContents?.send(AgentIpcChannels.BROWSER_NEW_TAB_SHORTCUT)
      } else if (input.key.toLowerCase() === 'w' && process.platform !== 'darwin') {
        // Guest webview keys never reach the host menu; on macOS the global menu
        // accelerator already fires, so intercept ⌃W here only for Windows/Linux.
        event.preventDefault()
        contents.hostWebContents?.send(AgentIpcChannels.CLOSE_TAB_SHORTCUT)
      }
    })
  })
}
