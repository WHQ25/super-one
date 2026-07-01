import { app, session } from 'electron'

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
  })
}
