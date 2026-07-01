import { app, session } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const BROWSER_PARTITION = 'persist:browser'

// The built-in browser <webview> allows popups (required for window.open to reach
// this handler at all), but has no place to host a native popup window. Convert
// window.open / target=_blank into a same-tab navigation in the originating webview
// so popup-based OAuth (e.g. Google Identity Services) proceeds inline like a redirect.
export function registerBrowserPopupRedirect(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    if (contents.session !== session.fromPartition(BROWSER_PARTITION)) return
    contents.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') {
        queueMicrotask(() => {
          if (!contents.isDestroyed()) void contents.loadURL(url)
        })
      }
      return { action: 'deny' }
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
      } else if (input.key.toLowerCase() === 't') {
        event.preventDefault()
        contents.hostWebContents?.send(AgentIpcChannels.BROWSER_NEW_TAB_SHORTCUT)
      }
    })
  })
}
