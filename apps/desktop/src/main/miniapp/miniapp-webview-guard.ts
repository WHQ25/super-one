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
  /** A mini-app, cleared to attach into its own origin/partition/preload. */
  | { kind: 'miniapp'; appId: string }
  /** Someone else's `<webview>` — this guard has no say over it. */
  | { kind: 'foreign' }
  | { kind: 'blocked'; reason: string }

/** Absolute path of the mini-app preload — the one bundle a mini-app may load. */
export function miniAppPreloadPath(): string {
  return join(__dirname, '../preload/miniapp-preload.js')
}

/**
 * Pure attach policy.
 *
 * `will-attach-webview` is a **window-level** event: it fires for every
 * `<webview>` the window renders, and the built-in browser mounts one too. So
 * the first question is not "is this a valid mini-app" but "is this a mini-app
 * at all" — answering the former for a browser tab is what silently kept the
 * browser from ever attaching.
 */
export function evaluateWebviewAttach(params: WebviewAttachParams): WebviewAttachDecision {
  // A preload is privilege, and nothing but a mini-app attaches one. An unknown
  // preload is the escalation this guard exists to stop, so it is judged before
  // the mini-app question — a foreign src must not buy its way past it.
  const hasPreload = params.preload.length > 0
  const isMiniAppPreload = hasPreload && resolve(params.preload) === resolve(params.expectedPreload)
  if (hasPreload && !isMiniAppPreload) {
    return { kind: 'blocked', reason: 'preload is not the mini-app preload' }
  }

  let appId = ''
  try {
    const src = new URL(params.src)
    if (src.protocol === 'superone-app:') appId = parseMiniAppUrlHost(src.host).appId
  } catch { /* reported as bad-src below */ }

  // Claiming any one of the three mini-app markers submits to all three checks,
  // so a half-formed impersonation is rejected rather than waved through as foreign.
  const claimsMiniApp = appId !== '' || params.partition.startsWith('persist:miniapp-') || isMiniAppPreload
  if (!claimsMiniApp) return { kind: 'foreign' }

  if (!APP_ID_RE.test(appId)) return { kind: 'blocked', reason: 'src is not a superone-app:// mini-app URL' }
  if (params.partition !== `persist:miniapp-${appId}`) return { kind: 'blocked', reason: `partition must be persist:miniapp-${appId}` }
  if (!isMiniAppPreload) return { kind: 'blocked', reason: 'preload is not the mini-app preload' }
  return { kind: 'miniapp', appId }
}

/** Wire attach validation + navigation containment for one mini-app-hosting window. */
export function attachMiniAppWebviewGuards(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const decision = evaluateWebviewAttach({
      src: params.src ?? '',
      partition: (params as { partition?: string }).partition ?? '',
      preload: typeof webPreferences.preload === 'string' ? webPreferences.preload : '',
      expectedPreload: miniAppPreloadPath(),
    })
    if (decision.kind === 'blocked') {
      event.preventDefault()
      log.warn('[miniapp-webview] blocked attachment src=%s: %s', params.src, decision.reason)
      return
    }
    // Worth applying to every guest, mini-app or not: no renderer in this app
    // has a reason to run a webview with node access or nested webview tags.
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.webviewTag = false
    if (decision.kind === 'foreign') return
    ensureMiniAppPartition(`persist:miniapp-${decision.appId}`)
    webPreferences.sandbox = true
  })

  win.webContents.on('did-attach-webview', (_event, contents) => {
    let allowedHost = ''
    try {
      const current = new URL(contents.getURL())
      if (current.protocol === 'superone-app:') allowedHost = current.host
    } catch { /* not a mini-app; left alone below */ }
    // Only a mini-app is pinned to its own origin. The browser is a browser —
    // containing it here would let it attach and then refuse to navigate.
    if (!allowedHost) return
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
