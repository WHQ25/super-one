import { app, ipcMain, session } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const BROWSER_PARTITION = 'persist:browser'

function isBrowserWebview(wc: Electron.WebContents): boolean {
  return wc.getType() === 'webview' && wc.session === session.fromPartition(BROWSER_PARTITION)
}

// Chromium's classic (space-taking) page scrollbar ignores the app theme — a light
// track on a dark page. Match the app's thin neutral thumb instead. User origin so
// any page that styles or hides its own scrollbars (author origin) still wins.
const BROWSER_SCROLLBAR_CSS = `
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: oklch(0.5 0 0 / 0.35) padding-box; border: 2px solid transparent; border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background-color: oklch(0.5 0 0 / 0.55); }
`

// Styled scrollbars always reserve a gutter, so leave native overlay scrollbars
// (macOS trackpad mode: no gutter, no track, auto-hide) alone. A non-auto
// `scrollbar-width` measures the native bar even when the page styles ::-webkit-scrollbar.
const CLASSIC_SCROLLBAR_PROBE = `(() => {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-100px;width:50px;height:50px;overflow:scroll;scrollbar-width:thin;visibility:hidden'
  document.documentElement.appendChild(el)
  const classic = el.offsetWidth > el.clientWidth
  el.remove()
  return classic
})()`

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

    // Inserted sheets die with their document, so re-check and re-apply per navigation.
    contents.on('dom-ready', () => {
      void contents.executeJavaScript(CLASSIC_SCROLLBAR_PROBE)
        .then((classic) => classic && contents.insertCSS(BROWSER_SCROLLBAR_CSS, { cssOrigin: 'user' }))
        .catch(() => {})
    })

    contents.on('certificate-error', (event, url, error, _certificate, callback) => {
      const host = certHost(url)
      if (host && allowedCertHosts.has(host)) {
        event.preventDefault()
        callback(true)
        return
      }
      contents.hostWebContents?.send(AgentIpcChannels.BROWSER_CERT_ERROR, { webContentsId: contents.id, url, error })
    })

    // The <webview> tag only surfaces media-started-playing, which fires for silent
    // media too. Audibility (Chrome's tab speaker signal) is a guest WebContents event.
    contents.on('audio-state-changed', ({ audible }) => {
      contents.hostWebContents?.send(AgentIpcChannels.BROWSER_AUDIO_STATE, { webContentsId: contents.id, audible })
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
      if (!mod || input.alt) return
      // Zoom before the shift bail: ⌘+ is ⌘⇧= on most layouts. The host owns these
      // keys too (main/index.ts), but that listener only fires while the host itself
      // holds keyboard focus — so with a page focused, zoom died everywhere.
      if (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0') {
        event.preventDefault()
        const action = input.key === '-' ? 'out' : input.key === '0' ? 'reset' : 'in'
        contents.hostWebContents?.send(AgentIpcChannels.CONTENT_ZOOM, action)
        return
      }
      if (input.shift) return
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
