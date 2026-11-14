import {
  chromeTabRef,
  isChromeTabId,
  parseChromeTabRef,
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

export interface ChromeRendererDispatch {
  (op: string, input: unknown, signal?: AbortSignal): Promise<unknown>
}

export type ChromeCallResult = { routed: false } | { routed: true; result: unknown }

let hub: ChromeBridgeHub = chromeBridgeHub
let tabs: ChromeTabInfo[] = []
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
  unsub = client.onEvent(handleEvent)
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

function handleEvent(event: ChromeBridgeEventName, params: ChromeBridgeEvents[ChromeBridgeEventName]): void {
  if (event === 'tabs.changed') {
    const next = (params as ChromeBridgeEvents['tabs.changed']).tabs ?? []
    const seen = new Set(next.map((tab) => tab.tabId))
    for (const tab of tabs) {
      if (!seen.has(tab.tabId)) dropTarget(tab.tabId, 'tab closed')
    }
    tabs = next
    return
  }
  if (event === 'cdp.event') {
    const body = params as ChromeBridgeEvents['cdp.event']
    const state = targets.get(chromeTargetId(body.tabId))
    if (!state) return
    if (body.method === 'Page.downloadWillBegin') noteDownloadBegin(body.tabId, body.params)
    rememberConsole(body.tabId, body.method, body.params)
    for (const listener of state.listeners) listener(body.method, body.params)
    return
  }
  if (event === 'cdp.detached') {
    const body = params as ChromeBridgeEvents['cdp.detached']
    dropTarget(body.tabId, body.reason || 'detached')
    return
  }
  if (event === 'downloads.progress') {
    const body = params as ChromeBridgeEvents['downloads.progress']
    const tabId = typeof body.tabId === 'number' ? body.tabId : tabIdForUrl(body.url)
    if (tabId == null) return
    recordChromePageDownload({
      guid: body.guid,
      url: body.url,
      filename: body.filename || fileName(body.path || body.url),
      path: body.path,
      bytes: body.bytes,
      state: body.state,
      startedAt: Date.now(),
      webContentsId: chromeTargetId(tabId),
    })
  }
}

function tabIdForUrl(url: string): number | null {
  const hit = tabs.find((tab) => tab.url === url)
  return hit ? hit.tabId : null
}

function fileName(pathOrUrl: string): string {
  const slash = Math.max(pathOrUrl.lastIndexOf('/'), pathOrUrl.lastIndexOf('\\'))
  return slash >= 0 ? pathOrUrl.slice(slash + 1) : pathOrUrl
}

function noteDownloadBegin(tabId: number, params: unknown): void {
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
    webContentsId: chromeTargetId(tabId),
  })
}

function rememberConsole(tabId: number, method: string, params: unknown): void {
  const entry = consoleEntry(method, params)
  if (!entry) return
  const buf = consoleBuffers.get(tabId) ?? []
  buf.push(entry)
  if (buf.length > CONSOLE_CAP) buf.splice(0, buf.length - CONSOLE_CAP)
  consoleBuffers.set(tabId, buf)
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

function dropTarget(tabId: number, reason: string): void {
  const id = chromeTargetId(tabId)
  const state = targets.get(id)
  prepared.delete(tabId)
  consoleBuffers.delete(tabId)
  if (!state) return
  targets.delete(id)
  unregisterCdpTransport(id)
  for (const listener of state.detach) listener(reason)
}

export function ensureChromeCdpTarget(tabId: number): CdpTransport {
  return transport(tabId)
}

function transport(tabId: number): CdpTransport {
  const id = chromeTargetId(tabId)
  const existing = cdpTransportFor(id)
  if (existing) return existing
  const state: TargetState = { listeners: new Set(), detach: new Set() }
  targets.set(id, state)
  const created: CdpTransport = {
    send: (method, params) => hub.call('cdp.send', { tabId, method, params: params ?? {} }),
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

async function ensureReady(tabId: number): Promise<void> {
  transport(tabId)
  if (prepared.has(tabId)) return
  prepared.add(tabId)
  const send = (method: string, params?: object) => hub.call('cdp.send', { tabId, method, params: params ?? {} })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  if (downloadDir) {
    await send(DOWNLOAD_DIR_COMMAND, { behavior: 'allow', downloadPath: downloadDir }).catch((err) => {
      log.warn('[chrome-browser] download behavior failed tab=%d %s', tabId, err instanceof Error ? err.message : String(err))
    })
  }
}

function eligible(owner: string): ChromeTabInfo[] {
  return tabs.filter((tab) => tab.kind === 'shared' || tab.owner === owner)
}

/**
 * Chrome's cookie jar is the right one when this session is not also driving
 * SuperOne's built-in browser. Several Chrome tabs still share that one jar.
 */
export async function ownerDrivesChromeOnly(
  owner: string,
  dispatch: ChromeRendererDispatch,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!hub.connected) return false
  if (eligible(owner).length === 0) return false
  const embedded = await embeddedBrowserTabs(dispatch, signal)
  return embedded.length === 0
}

const CHROME_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export interface ChromeHostDownload {
  path: string
  filename: string
  bytes: number
  mimeType: string
  state: 'completed'
}

/** Download with Chrome's own cookie jar. The file lands in Chrome's download directory. */
export async function chromeHostDownload(url: string, filename?: string): Promise<ChromeHostDownload> {
  const result = await hub.call('downloads.download', {
    url,
    ...(filename ? { filename } : {}),
  }, { timeoutMs: CHROME_DOWNLOAD_TIMEOUT_MS })
  if (!result?.path) throw new Error('Chrome download finished without a file')
  return result
}

function requireTab(owner: string, tab: string): ChromeTabInfo {
  const tabId = parseChromeTabRef(tab)
  const info = eligible(owner).find((item) => item.tabId === tabId)
  if (!info) throw new Error(`Chrome tab not found in this session: ${tab}`)
  return info
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

async function resolveOmitted(owner: string, dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<ChromeTabInfo | null> {
  const mine = eligible(owner)
  if (mine.length === 0) return null
  const embedded = await embeddedBrowserTabs(dispatch, signal)
  if (mine.length === 1 && embedded.length === 0) return mine[0]
  const ids = [...embedded.map((tab) => tab.tab), ...mine.map((tab) => chromeTabRef(tab.tabId))]
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
  transport(info.tabId)
  return chromeTargetId(info.tabId)
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

function describeTab(tab: ChromeTabInfo): Record<string, unknown> {
  return {
    tab: chromeTabRef(tab.tabId),
    url: tab.url,
    title: tab.title,
    loading: tab.loading,
    host: 'chrome',
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
  return { webContentsIds: [...embedded, ...eligible(owner).map((tab) => chromeTargetId(tab.tabId))] }
}

async function closeMixed(owner: string, requested: string[], dispatch: ChromeRendererDispatch, signal?: AbortSignal): Promise<unknown> {
  const chromeIds = requested.filter((id) => isChromeTabId(id))
  const embeddedIds = requested.filter((id) => !isChromeTabId(id))
  const closed: string[] = []
  const failed: Array<{ tab: string; error: string }> = []
  for (const id of chromeIds) {
    try {
      const info = requireTab(owner, id)
      await hub.call('tabs.close', { tabId: info.tabId }, { signal })
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
  const created = await hub.call('tabs.create', { owner, url: 'about:blank' }, { signal })
  transport(created.tabId)
  return { ok: true, tab: chromeTabRef(created.tabId), url: created.url, title: created.title }
}

async function runChromeOp(owner: string, info: ChromeTabInfo, op: string, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const tab = chromeTabRef(info.tabId)
  if (op === 'open') return { ok: true, tab, url: info.url, title: info.title }
  if (op === 'close') {
    await hub.call('tabs.close', { tabId: info.tabId }, { signal })
    return { ok: true, closed: [tab], remaining: eligible(owner).filter((item) => item.tabId !== info.tabId).length }
  }
  if (op === 'resolveWebContentsId') {
    transport(info.tabId)
    return { webContentsId: chromeTargetId(info.tabId) }
  }
  if (op === 'focusView') {
    await hub.call('tabs.activate', { tabId: info.tabId }, { signal })
    return { ok: true }
  }
  await ensureReady(info.tabId)
  const exec: PageScriptExecutor = (script) => evaluate(info.tabId, script, signal)
  const pageInput = raw as PageScriptInput
  switch (op) {
    case 'snapshot':
      return snapshot(info.tabId, exec, pageInput)
    case 'screenshot':
      return screenshot(info.tabId, exec, raw.selector, signal)
    case 'navigate':
      return navigate(info.tabId, raw, signal)
    case 'evaluate': {
      const value = await exec(evaluateExpressionScript(raw.expression))
      assertEvaluateResultSize(value)
      return { value: value ?? null }
    }
    case 'resolvePoint': {
      const point = await resolvePagePoint(exec, pageInput)
      return { ...point, webContentsId: chromeTargetId(info.tabId) }
    }
    case 'emulateViewport':
      return emulateViewport(info.tabId, raw, signal)
    case 'recordStart': {
      const started = await hub.call('record.start', { tabId: info.tabId }, { signal, timeoutMs: 15_000 })
      return { ...started, tab }
    }
    case 'recordStop': {
      if (typeof raw.recordingId !== 'string') throw new Error('recordStop requires recordingId')
      return hub.call('record.stop', { tabId: info.tabId, recordingId: raw.recordingId }, { signal, timeoutMs: 70_000 })
    }
    default:
      if (op === 'query' || op === 'inspect' || op === 'click' || op === 'hover' || op === 'type' || op === 'press' || op === 'scroll' || op === 'select' || op === 'drag' || op === 'wait_for') {
        return runPageScriptOp(exec, op, pageInput)
      }
      throw new Error(`Chrome browser cannot run '${op}'`)
  }
}

async function evaluate(tabId: number, script: string, signal?: AbortSignal): Promise<unknown> {
  const res = await hub.call('cdp.send', {
    tabId,
    method: 'Runtime.evaluate',
    params: { expression: script, returnByValue: true, awaitPromise: true, userGesture: true },
  }, { signal }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Page script failed')
  }
  return res?.result?.value
}

async function snapshot(tabId: number, exec: PageScriptExecutor, input: PageScriptInput): Promise<Record<string, unknown>> {
  const page = await snapshotPage(exec, input)
  if (snapshotInclude(input).includes('console')) page.console = readConsole(tabId, input.console)
  return page
}

function readConsole(tabId: number, query: unknown): ConsoleEntry[] {
  const q = (query ?? {}) as { level?: ConsoleEntry['level'][]; grep?: string; regex?: boolean; ignoreCase?: boolean; invert?: boolean; max?: number }
  const levels = new Set(q.level?.length ? q.level : ['warning', 'error'])
  let list = (consoleBuffers.get(tabId) ?? []).filter((entry) => levels.has(entry.level))
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

async function screenshot(tabId: number, exec: PageScriptExecutor, selector: unknown, signal?: AbortSignal): Promise<unknown> {
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
    tabId,
    method: 'Page.captureScreenshot',
    params: { format: 'png', fromSurface: true, ...(clip ? { clip } : {}) },
  }, { signal, timeoutMs: 20_000 }) as { data?: string }
  if (!shot?.data) throw new Error('Screenshot capture failed')
  const size = pngSize(shot.data)
  return { mimeType: 'image/png', data: shot.data, width: size.width, height: size.height }
}

function pngSize(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64.slice(0, 128), 'base64')
  if (buf.length < 24) return { width: 0, height: 0 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function navigate(tabId: number, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const action = raw.action === 'back' || raw.action === 'forward' || raw.action === 'reload' ? raw.action : undefined
  const url = action ? undefined : resolveNavigateUrl({
    url: typeof raw.url === 'string' ? raw.url : undefined,
    port: typeof raw.port === 'number' ? raw.port : undefined,
    path: typeof raw.path === 'string' ? raw.path : undefined,
    protocol: raw.protocol === 'https' ? 'https' : raw.protocol === 'http' ? 'http' : undefined,
  })
  const info = await hub.call('tabs.navigate', {
    tabId,
    ...(url ? { url } : {}),
    ...(action ? { action } : {}),
    wait: raw.readiness !== 'none',
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
  }, { signal, timeoutMs: 60_000 })
  return { ok: true, action: action ?? 'navigate', url: info.url, title: info.title, loading: info.loading, tab: chromeTabRef(info.tabId) }
}

async function emulateViewport(tabId: number, raw: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const send = (method: string, params: object) => hub.call('cdp.send', { tabId, method, params }, { signal })
  if (raw.reset === true || raw.width == null || raw.height == null) {
    await send('Emulation.clearDeviceMetricsOverride', {}).catch(() => undefined)
    return { ok: true }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: raw.width, height: raw.height, deviceScaleFactor: 0, mobile: false })
  return { ok: true }
}
