import { join, resolve } from 'path'
import { session, shell, type BrowserWindow } from 'electron'
import { parseMiniAppUrlHost } from '@superone/shared/miniapp-url'
import log from '../logger'
import { registerMiniAppProtocolHandlers } from './miniapp-protocol'

const APP_ID_RE = /^[a-z0-9][a-z0-9_-]*$/

const registeredPartitions = new Set<string>()

/**
 * Mini-app `<webview>` tags are not exclusive to the main window — a detached
 * session window renders the same chat, so its standalone tool blocks and tool
 * renderers mount WebViews too. Every window that can render mini-app content
 * must enable `webviewTag` AND wire these guards, or the tag silently renders
 * nothing and `superone-app://` is never registered for the partition.
 */
export function ensureMiniAppPartition(partition: string): void {
  if (registeredPartitions.has(partition)) return
  registerMiniAppProtocolHandlers(session.fromPartition(partition).protocol)
  registeredPartitions.add(partition)
}

export interface WebviewAttachParams {
  src: string
  partition: string
  preload: string
  expectedPreload: string
}

export type WebviewAttachDecision =
  | { ok: true; appId: string }
  | { ok: false; reason: string }

/** Pure attach policy: only this app's own preload, partition, and origin. */
export function evaluateWebviewAttach(params: WebviewAttachParams): WebviewAttachDecision {
  let appId = ''
  try {
    const src = new URL(params.src)
    if (src.protocol === 'superone-app:') appId = parseMiniAppUrlHost(src.host).appId
  } catch { /* reported as bad-src below */ }
  if (!APP_ID_RE.test(appId)) return { ok: false, reason: 'src is not a superone-app:// mini-app URL' }
  if (params.partition !== `persist:miniapp-${appId}`) return { ok: false, reason: `partition must be persist:miniapp-${appId}` }
  if (!params.preload || resolve(params.preload) !== resolve(params.expectedPreload)) {
    return { ok: false, reason: 'preload is not the mini-app preload' }
  }
  return { ok: true, appId }
}

/** Wire attach validation + navigation containment for one mini-app-hosting window. */
export function attachMiniAppWebviewGuards(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const decision = evaluateWebviewAttach({
      src: params.src ?? '',
      partition: (params as { partition?: string }).partition ?? '',
      preload: typeof webPreferences.preload === 'string' ? webPreferences.preload : '',
      expectedPreload: join(__dirname, '../preload/miniapp-preload.js'),
    })
    if (!decision.ok) {
      event.preventDefault()
      log.warn('[miniapp-webview] blocked attachment src=%s: %s', params.src, decision.reason)
      return
    }
    ensureMiniAppPartition(`persist:miniapp-${decision.appId}`)
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webviewTag = false
  })

  win.webContents.on('did-attach-webview', (_event, contents) => {
    let allowedHost = ''
    try {
      const current = new URL(contents.getURL())
      if (current.protocol === 'superone-app:') allowedHost = current.host
    } catch { /* navigation is blocked below */ }
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      try {
        const next = new URL(url)
        if (next.protocol !== 'superone-app:' || next.host !== allowedHost) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })
  })
}
