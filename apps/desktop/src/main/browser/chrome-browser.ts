import {
  chromeTabRef,
  isChromeTabId,
  parseChromeTabTarget,
  type ChromeBridgeEventName,
  type ChromeBridgeEvents,
  type ChromeTabInfo,
} from '@superone/shared/chrome-bridge-protocol'
import {
  assertEvaluateResultSize,
  evaluateExpressionScript,
  resolvePagePoint,
  runPageScriptOp,
  snapshotInclude,
  snapshotPage,
  type PageScriptExecutor,
  type PageScriptInput,
} from '@superone/shared/browser-automation-ops'
import { resolveNavigateUrl } from '@superone/shared/browser-automation-scripts'
import { chromeBridgeHub, type ChromeBridgeHub } from './chrome-bridge-hub'
import { noteChromePageDownload, recordChromePageDownload } from './chrome-download-feed'
import {
  cdpTransportFor,
  chromeTargetId,
  registerCdpTransport,
  unregisterCdpTransport,
  type CdpDetachListener,
  type CdpMessageListener,
  type CdpTransport,
} from './cdp-transport'
import log from '../logger'

const RENDERER_ONLY = new Set([
  'miniappPreview',
  'miniappReload',
  'miniappOpen',
  'layoutSnapshot',
  'layoutAct',
  'tabPresentation',
  'focusGuardBegin',
  'focusGuardEnd',
])

const DOWNLOAD_DIR_COMMAND = 'Page.setDownloadBehavior'

interface TargetState {
  listeners: Set<CdpMessageListener>
  detach: Set<CdpDetachListener>
}

interface ConsoleEntry {
  level: 'log' | 'info' | 'warning' | 'error'
  text: string
  timestamp: string
}

interface TrackedTab extends ChromeTabInfo {
  browser: string
}

export interface ChromeRendererDispatch {
  (op: string, input: unknown, signal?: AbortSignal): Promise<unknown>
}

export type ChromeCallResult = { routed: false } | { routed: true; result: unknown }

let hub: ChromeBridgeHub = chromeBridgeHub
let tabs: TrackedTab[] = []
let unsub: (() => void) | null = null
const targets = new Map<number, TargetState>()
const prepared = new Set<number>()
const consoleBuffers = new Map<number, ConsoleEntry[]>()
const CONSOLE_CAP = 200
let downloadDir = ''

export function chromeBridgeIsConnected(): boolean {
  return hub.connected
}

export function bindChromeBridge(client: ChromeBridgeHub, opts?: { downloadDir?: string }): void {
  unsub?.()
  hub = client
  downloadDir = opts?.downloadDir ?? downloadDir
  const offEvent = client.onEvent(handleEvent)
  const offConnection = client.onConnection(() => forgetDisconnected())
  unsub = () => {
    offEvent()
    offConnection()
  }
}

export function setChromeDownloadDir(dir: string): void {
  downloadDir = dir
}

export function resetChromeBrowserForTests(): void {
  unsub?.()
  unsub = null
  tabs = []
  prepared.clear()
  consoleBuffers.clear()
  for (const id of targets.keys()) unregisterCdpTransport(id)
  targets.clear()
  hub = chromeBridgeHub
}

function endpointId(browser: string, tabId: number): number {
  return chromeTargetId(tabId, browser)
}

function forgetDisconnected(): void {
  const live = new Set(hub.browsers())
  for (const tab of tabs) {
    if (!live.has(tab.browser)) dropTarget(tab.browser, tab.tabId)
  }
  tabs = tabs.filter((tab) => live.has(tab.browser))
}

function handleEvent(
  event: ChromeBridgeEventName,
  params: ChromeBridgeEvents[ChromeBridgeEventName],
  browser: string,
): void {
  if (event === 'tabs.changed') {
    const next = ((params as ChromeBridgeEvents['tabs.changed']).tabs ?? []).map((tab) => ({ ...tab, browser }))
    const seen = new Set(next.map((tab) => tab.tabId))
    for (const tab of tabs) {
      if (tab.browser === browser && !seen.has(tab.tabId)) dropTarget(tab.browser, tab.tabId)
    }
    tabs = [...tabs.filter((tab) => tab.browser !== browser), ...next]
    return
  }
  if (event === 'cdp.event') {
    const body = params as ChromeBridgeEvents['cdp.event']
    const state = targets.get(endpointId(browser, body.tabId))
    if (!state) return
    if (body.method === 'Page.downloadWillBegin') noteDownloadBegin(browser, body.tabId, body.params)
    rememberConsole(browser, body.tabId, body.method, body.params)
    for (const listener of state.listeners) listener(body.method, body.params)
    return
  }
  if (event === 'cdp.detached') {
    const body = params as ChromeBridgeEvents['cdp.detached']
    dropTarget(browser, body.tabId, body.reason || 'detached')
    return
  }
  if (event === 'downloads.progress') {
    const body = params as ChromeBridgeEvents['downloads.progress']
    const tabId = typeof body.tabId === 'number' ? body.tabId : tabIdForUrl(browser, body.url)
    if (tabId == null) return
    recordChromePageDownload({
      guid: body.guid,
      url: body.url,
      filename: body.filename || fileName(body.path || body.url),
      path: body.path,
      bytes: body.bytes,
      state: body.state,
      startedAt: Date.now(),
      webContentsId: endpointId(browser, tabId),
    })
  }
}

function tabIdForUrl(browser: string, url: string): number | null {
  const hit = tabs.find((tab) => tab.browser === browser && tab.url === url)
  return hit ? hit.tabId : null
}

function fileName(pathOrUrl: string): string {
  const slash = Math.max(pathOrUrl.lastIndexOf('/'), pathOrUrl.lastIndexOf('\\'))
  return slash >= 0 ? pathOrUrl.slice(slash + 1) : pathOrUrl
}

function noteDownloadBegin(browser: string, tabId: number, params: unknown): void {
  const body = params as { guid?: string; url?: string; suggestedFilename?: string }
  if (!body.guid) return
  noteChromePageDownload({
    guid: body.guid,
    url: body.url ?? '',
    filename: body.suggestedFilename || fileName(body.url ?? 'download'),
    path: '',
    bytes: 0,
    state: 'progressing',
    startedAt: Date.now(),
    webContentsId: endpointId(browser, tabId),
  })
}

function rememberConsole(browser: string, tabId: number, method: string, params: unknown): void {
  const entry = consoleEntry(method, params)
  if (!entry) return
  const id = endpointId(browser, tabId)
  const buf = consoleBuffers.get(id) ?? []
  buf.push(entry)
  if (buf.length > CONSOLE_CAP) buf.splice(0, buf.length - CONSOLE_CAP)
  consoleBuffers.set(id, buf)
}

function consoleEntry(method: string, params: unknown): ConsoleEntry | null {
  if (method === 'Runtime.exceptionThrown') {
    const text = (params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails
    return { level: 'error', text: (text?.exception?.description || text?.text || 'exception').slice(0, 2000), timestamp: new Date().toISOString() }
  }
  if (method === 'Log.entryAdded') {
    const entry = (params as { entry?: { level?: string; text?: string } }).entry
    if (!entry?.text) return null
    return { level: normalizeLevel(entry.level), text: entry.text.slice(0, 2000), timestamp: new Date().toISOString() }
  }
  if (method === 'Runtime.consoleAPICalled') {
    const body = params as { type?: string; args?: Array<{ value?: unknown; description?: string; unserializableValue?: string }> }
    const text = (body.args ?? []).map((arg) => arg.value != null ? String(arg.value) : arg.description || arg.unserializableValue || '').join(' ')
    return { level: normalizeLevel(body.type), text: text.slice(0, 2000), timestamp: new Date().toISOString() }
  }
  return null
}

function normalizeLevel(level: string | undefined): ConsoleEntry['level'] {
  if (level === 'warning' || level === 'warn') return 'warning'
  if (level === 'error' || level === 'assert') return 'error'
  if (level === 'info') return 'info'
  return 'log'
}

function dropTarget(browser: string, tabId: number, reason = 'tab closed'): void {
  const id = endpointId(browser, tabId)
  const state = targets.get(id)
  prepared.delete(id)
  consoleBuffers.delete(id)
  if (!state) return
  targets.delete(id)
  unregisterCdpTransport(id)
  for (const listener of state.detach) listener(reason)
}

export function ensureChromeCdpTarget(tabId: number, browser = 'chrome'): CdpTransport {
  return transport(browser, tabId)
}

function transport(browser: string, tabId: number): CdpTransport {
  const id = endpointId(browser, tabId)
  const existing = cdpTransportFor(id)
  if (existing) return existing
  const state: TargetState = { listeners: new Set(), detach: new Set() }
  targets.set(id, state)
  const created: CdpTransport = {
    send: (method, params) => hub.call('cdp.send', { tabId, method, params: params ?? {} }, { browserId: browser }),
    subscribe(listener) {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    onDetach(listener) {
      state.detach.add(listener)
      return () => state.detach.delete(listener)
    },
  }
  registerCdpTransport(id, created)
  return created
}

async function ensureReady(browser: string, tabId: number): Promise<void> {
  transport(browser, tabId)
  const id = endpointId(browser, tabId)
  if (prepared.has(id)) return
  prepared.add(id)
  const send = (method: string, params?: object) => hub.call('cdp.send', { tabId, method, params: params ?? {} }, { browserId: browser })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  if (downloadDir) {
    await send(DOWNLOAD_DIR_COMMAND, { behavior: 'allow', downloadPath: downloadDir }).catch((err) => {
      log.warn('[chrome-browser] download behavior failed browser=%s tab=%d %s', browser, tabId, err instanceof Error ? err.message : String(err))
    })
  }
}

function eligible(owner: string): TrackedTab[] {
  return tabs.filter((tab) => tab.kind === 'shared' || tab.owner === owner)
}

/**
 * The extension browser whose cookie jar this session is driving, when every
 * eligible tab is in that one browser and no built-in tab is open.
 */
export async function ownerChromeCookieBrowser(
  owner: string,
  dispatch: ChromeRendererDispatch,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!hub.connected) return null
  const browsers = new Set(eligible(owner).map((tab) => tab.browser))
  if (browsers.size !== 1) return null
  const embedded = await embeddedBrowserTabs(dispatch, signal)
  if (embedded.length > 0) return null
  return [...browsers][0] ?? null
}

/** Chrome's cookie jar is the right one when `ownerChromeCookieBrowser` names one browser. */
export async function ownerDrivesChromeOnly(
  owner: string,
  dispatch: ChromeRendererDispatch,
  signal?: AbortSignal,
): Promise<boolean> {
  return (await ownerChromeCookieBrowser(owner, dispatch, signal)) != null
}

const CHROME_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export interface ChromeHostDownload {
  path: string
  filename: string
  bytes: number
  mimeType: string
  state: 'completed'
}

/** Download with the connected browser's own cookie jar. The file lands in that browser's download directory. */
export async function chromeHostDownload(url: string, filename?: string, browserId?: string): Promise<ChromeHostDownload> {
  const browser = connectedBrowser(browserId)
  const result = await hub.call('downloads.download', {
    url,
    ...(filename ? { filename } : {}),
  }, { timeoutMs: CHROME_DOWNLOAD_TIMEOUT_MS, browserId: browser })
  if (!result?.path) throw new Error('Chrome download finished without a file')
  return result
}

function connectedBrowser(requested?: string): string {
  const live = hub.browsers()
  if (requested) {
    if (!live.includes(requested)) {
      throw new Error(`Browser "${requested}" is not connected. Connected: ${live.join(', ') || 'none'}.`)
    }
    return requested
  }
  if (live.length === 1) return live[0]!
  if (live.length === 0) throw new Error('Chrome bridge is not connected. Open the SuperOne extension in the browser.')
  throw new Error(`More than one browser extension is connected (${live.join(', ')}). Pass browser, or a tab id like chrome:<browser>:<id>.`)
}

function requireTab(owner: string, tab: string): TrackedTab {
  const parsed = parseChromeTabTarget(tab)
  const matches = eligible(owner).filter((item) => item.tabId === parsed.tabId && (!parsed.browser || item.browser === parsed.browser))
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) throw new Error(`Chrome tab not found in this session: ${tab}`)
  throw new Error(`Chrome tab ${tab} is open in more than one browser (${matches.map((item) => item.browser).join(', ')}). Use chrome:<browser>:<id>.`)
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function tabField(input: unknown): string | string[] | undefined {
  const tab = inputRecord(input).tab
  if (typeof tab === 'string' || Array.isArray(tab)) return tab as string | string[]
  return undefined
}

async function embeddedBrowserTabs(dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<Array<{ tab: string }>> {
  try {
    const listed = await dispatch('tabs', {}, signal) as { tabs?: Array<{ tab?: string }> }
    return (listed.tabs ?? []).filter((tab): tab is { tab: string } => typeof tab.tab === 'string' && !tab.tab.startsWith('miniapp:') && !isChromeTabId(tab.tab))
  } catch {
    return []
  }
}

async function resolveOmitted(owner: string, dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<TrackedTab | null> {
  const mine = eligible(owner)
  if (mine.length === 0) return null
  const embedded = await embeddedBrowserTabs(dispatch, signal)
  if (mine.length === 1 && embedded.length === 0) return mine[0]!
  const ids = [...embedded.map((tab) => tab.tab), ...mine.map((tab) => chromeTabRef(tab.tabId, tab.browser))]
  throw new Error(`Multiple browser tabs are open; specify "tab". Open tabs: ${ids.join(', ')}`)
}

/** Synthetic webContents id when this call targets Chrome, otherwise null so the renderer resolves it. */
export async function chromeWebContentsId(
  owner: string,
  tab: string | undefined,
  dispatch: ChromeRendererDispatch,
  signal?: AbortSignal,
): Promise<number | null> {
  if (!hub.connected) return null
  if (tab && !isChromeTabId(tab)) return null
  const info = tab ? requireTab(owner, tab) : await resolveOmitted(owner, dispatch, signal)
  if (!info) return null
  transport(info.browser, info.tabId)
  return endpointId(info.browser, info.tabId)
}

export async function tryChromeBrowserCall(
  owner: string,
  op: string,
  input: unknown,
  signal: AbortSignal | undefined,
  dispatch: ChromeRendererDispatch,
): Promise<ChromeCallResult> {
  if (RENDERER_ONLY.has(op) || !hub.connected) return { routed: false }
  if (op === 'tabs') return { routed: true, result: await listTabs(owner, dispatch, signal) }
  if (op === 'ownedWebContentsIds') return { routed: true, result: await ownedIds(owner, dispatch, signal) }
  const raw = inputRecord(input)
  const host = raw.host
  const tab = tabField(input)
  if (op === 'close' && Array.isArray(tab) && tab.some((id) => isChromeTabId(id))) {
    return { routed: true, result: await closeMixed(owner, tab, dispatch, signal) }
  }
  if (op === 'open' && host === 'chrome' && typeof tab !== 'string') {
    return { routed: true, result: await openTab(owner, raw, signal) }
  }
  if (typeof tab === 'string' && !isChromeTabId(tab)) return { routed: false }
  if (Array.isArray(tab)) return { routed: false }
  const info = typeof tab === 'string'
    ? requireTab(owner, tab)
    : await resolveOmitted(owner, dispatch, signal)
  if (!info) return { routed: false }
  return { routed: true, result: await runChromeOp(owner, info, op, raw, signal) }
}

async function listTabs(owner: string, dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<unknown> {
  let embedded: unknown[] = []
  try {
    const listed = await dispatch('tabs', {}, signal) as { tabs?: unknown[] }
    embedded = listed.tabs ?? []
  } catch {
    embedded = []
  }
  const chrome = eligible(owner).map(describeTab)
  const tabsOut = [...embedded, ...chrome]
  return { tabs: tabsOut, count: tabsOut.length }
}

function describeTab(tab: TrackedTab): Record<string, unknown> {
  return {
    tab: chromeTabRef(tab.tabId, tab.browser),
    url: tab.url,
    title: tab.title,
    loading: tab.loading,
    host: 'chrome',
    browser: tab.browser,
    kind: tab.kind,
  }
}

async function ownedIds(owner: string, dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<unknown> {
  let embedded: number[] = []
  try {
    const listed = await dispatch('ownedWebContentsIds', {}, signal) as { webContentsIds?: number[] }
    embedded = listed.webContentsIds ?? []
  } catch {
    embedded = []
  }
  return { webContentsIds: [...embedded, ...eligible(owner).map((tab) => endpointId(tab.browser, tab.tabId))] }
}

async function closeMixed(owner: string, requested: string[], dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<unknown> {
  const chromeIds = requested.filter((id) => isChromeTabId(id))
  const embeddedIds = requested.filter((id) => !isChromeTabId(id))
  const closed: string[] = []
  const failed: Array<{ tab: string; error: string }> = []
  for (const id of chromeIds) {
    try {
      const info = requireTab(owner, id)
      await hub.call('tabs.close', { tabId: info.tabId }, { signal, browserId: info.browser })
      closed.push(id)
    } catch (err) {
      failed.push({ tab: id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  if (embeddedIds.length) {
    try {
      const result = await dispatch('close', { tab: embeddedIds }, signal) as { closed?: string[]; failed?: Array<{ tab: string; error: string }> }
      closed.push(...(result.closed ?? []))
      failed.push(...(result.failed ?? []))
    } catch (err) {
      for (const id of embeddedIds) failed.push({ tab: id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return {
    ok: failed.length === 0,
    closed,
    ...(failed.length ? { error: `${failed.length} of ${requested.length} tabs could not be closed`, failed } : {}),
    remaining: eligible(owner).length,
  }
}

async function openTab(owner: string, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const browser = connectedBrowser(typeof raw.browser === 'string' ? raw.browser : undefined)
  const created = await hub.call('tabs.create', { owner, url: 'about:blank' }, { signal, browserId: browser })
  transport(browser, created.tabId)
  return { ok: true, tab: chromeTabRef(created.tabId, browser), url: created.url, title: created.title }
}

async function runChromeOp(owner: string, info: TrackedTab, op: string, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const tab = chromeTabRef(info.tabId, info.browser)
  if (op === 'open') return { ok: true, tab, url: info.url, title: info.title }
  if (op === 'close') {
    await hub.call('tabs.close', { tabId: info.tabId }, { signal, browserId: info.browser })
    return {
      ok: true,
      closed: [tab],
      remaining: eligible(owner).filter((item) => item.browser !== info.browser || item.tabId !== info.tabId).length,
    }
  }
  if (op === 'resolveWebContentsId') {
    transport(info.browser, info.tabId)
    return { webContentsId: endpointId(info.browser, info.tabId) }
  }
  if (op === 'focusView') {
    await hub.call('tabs.activate', { tabId: info.tabId }, { signal, browserId: info.browser })
    return { ok: true }
  }
  await ensureReady(info.browser, info.tabId)
  const exec: PageScriptExecutor = (script) => evaluate(info.browser, info.tabId, script, signal)
  const pageInput = raw as PageScriptInput
  switch (op) {
    case 'snapshot':
      return snapshot(info, exec, pageInput)
    case 'screenshot':
      return screenshot(info, exec, raw.selector, signal)
    case 'navigate':
      return navigate(info, raw, signal)
    case 'evaluate': {
      const value = await exec(evaluateExpressionScript(raw.expression))
      assertEvaluateResultSize(value)
      return { value: value ?? null }
    }
    case 'resolvePoint': {
      const point = await resolvePagePoint(exec, pageInput)
      return { ...point, webContentsId: endpointId(info.browser, info.tabId) }
    }
    case 'emulateViewport':
      return emulateViewport(info, raw, signal)
    case 'recordStart': {
      const started = await hub.call('record.start', { tabId: info.tabId }, { signal, timeoutMs: 15_000, browserId: info.browser })
      return { ...started, tab }
    }
    case 'recordStop': {
      if (typeof raw.recordingId !== 'string') throw new Error('recordStop requires recordingId')
      return hub.call('record.stop', { tabId: info.tabId, recordingId: raw.recordingId }, { signal, timeoutMs: 70_000, browserId: info.browser })
    }
    default:
      if (op === 'query' || op === 'inspect' || op === 'click' || op === 'hover' || op === 'type' || op === 'press' || op === 'scroll' || op === 'select' || op === 'drag' || op === 'wait_for') {
        return runPageScriptOp(exec, op, pageInput)
      }
      throw new Error(`Chrome browser cannot run '${op}'`)
  }
}

async function evaluate(browser: string, tabId: number, script: string, signal?: AbortSignal): Promise<unknown> {
  const res = await hub.call('cdp.send', {
    tabId,
    method: 'Runtime.evaluate',
    params: { expression: script, returnByValue: true, awaitPromise: true, userGesture: true },
  }, { signal, browserId: browser }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Page script failed')
  }
  return res?.result?.value
}

async function snapshot(info: TrackedTab, exec: PageScriptExecutor, input: PageScriptInput): Promise<Record<string, unknown>> {
  const page = await snapshotPage(exec, input)
  if (snapshotInclude(input).includes('console')) page.console = readConsole(info.browser, info.tabId, input.console)
  return page
}

function readConsole(browser: string, tabId: number, query: unknown): ConsoleEntry[] {
  const q = (query ?? {}) as { level?: ConsoleEntry['level'][]; grep?: string; regex?: boolean; ignoreCase?: boolean; invert?: boolean; max?: number }
  const levels = new Set(q.level?.length ? q.level : ['warning', 'error'])
  let list = (consoleBuffers.get(endpointId(browser, tabId)) ?? []).filter((entry) => levels.has(entry.level))
  if (q.grep) {
    const flags = q.ignoreCase === false ? '' : 'i'
    const matches = q.regex === true
      ? (text: string) => new RegExp(q.grep!, flags).test(text)
      : (text: string) => (q.ignoreCase === false ? text : text.toLowerCase()).includes(q.ignoreCase === false ? q.grep! : q.grep!.toLowerCase())
    const invert = q.invert === true
    list = list.filter((entry) => matches(entry.text) !== invert)
  }
  const max = q.max && q.max > 0 ? q.max : 50
  return list.slice(-max)
}

async function screenshot(info: TrackedTab, exec: PageScriptExecutor, selector: unknown, signal?: AbortSignal): Promise<unknown> {
  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
  if (typeof selector === 'string' && selector) {
    const box = await exec(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, vw: innerWidth, vh: innerHeight }; })()`) as { x: number; y: number; width: number; height: number; vw: number; vh: number } | null
    if (!box) throw new Error(`No element matches selector: ${selector}`)
    const x = Math.max(0, Math.floor(box.x))
    const y = Math.max(0, Math.floor(box.y))
    const right = Math.min(box.vw, Math.ceil(box.x + box.width))
    const bottom = Math.min(box.vh, Math.ceil(box.y + box.height))
    if (right <= x || bottom <= y) throw new Error('Screenshot selector is outside the visible viewport; scroll it into view with browser_scroll and retry')
    clip = { x, y, width: right - x, height: bottom - y, scale: 1 }
  }
  const shot = await hub.call('cdp.send', {
    tabId: info.tabId,
    method: 'Page.captureScreenshot',
    params: { format: 'png', fromSurface: true, ...(clip ? { clip } : {}) },
  }, { signal, timeoutMs: 20_000, browserId: info.browser }) as { data?: string }
  if (!shot?.data) throw new Error('Screenshot capture failed')
  const size = pngSize(shot.data)
  return { mimeType: 'image/png', data: shot.data, width: size.width, height: size.height }
}

function pngSize(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64.slice(0, 128), 'base64')
  if (buf.length < 24) return { width: 0, height: 0 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function navigate(info: TrackedTab, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const action = raw.action === 'back' || raw.action === 'forward' || raw.action === 'reload' ? raw.action : undefined
  const url = action ? undefined : resolveNavigateUrl({
    url: typeof raw.url === 'string' ? raw.url : undefined,
    port: typeof raw.port === 'number' ? raw.port : undefined,
    path: typeof raw.path === 'string' ? raw.path : undefined,
    protocol: raw.protocol === 'https' ? 'https' : raw.protocol === 'http' ? 'http' : undefined,
  })
  const next = await hub.call('tabs.navigate', {
    tabId: info.tabId,
    ...(url ? { url } : {}),
    ...(action ? { action } : {}),
    wait: raw.readiness !== 'none',
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
  }, { signal, timeoutMs: 60_000, browserId: info.browser })
  return { ok: true, action: action ?? 'navigate', url: next.url, title: next.title, loading: next.loading, tab: chromeTabRef(next.tabId, info.browser) }
}

async function emulateViewport(info: TrackedTab, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const send = (method: string, params: object) => hub.call('cdp.send', { tabId: info.tabId, method, params }, { signal, browserId: info.browser })
  if (raw.reset === true || raw.width == null || raw.height == null) {
    await send('Emulation.clearDeviceMetricsOverride', {}).catch(() => undefined)
    return { ok: true }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: raw.width, height: raw.height, deviceScaleFactor: 0, mobile: false })
  return { ok: true }
}
