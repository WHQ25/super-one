import { ensureAttachedById, cdpSend, isCdpMockEnabled } from './browser-cdp'
import log from '../logger'

const BUFFER_CAP = 300

interface NetworkEntry {
  requestId: string
  url: string
  method: string
  resourceType?: string
  status: number | null
  statusText?: string
  mimeType?: string
  size?: number
  failed?: boolean
  errorText?: string
  finished: boolean
}

const buffers = new Map<number, NetworkEntry[]>()
const byRequestId = new Map<number, Map<string, NetworkEntry>>()
const listening = new Set<number>()

interface MockRule {
  urlPattern: string
  status: number
  body: string
  contentType: string
  headers?: Record<string, string>
}
const mockRules = new Map<number, MockRule[]>()
const fetchEnabled = new Set<number>()

function cleanup(webContentsId: number): void {
  buffers.delete(webContentsId)
  byRequestId.delete(webContentsId)
  listening.delete(webContentsId)
  mockRules.delete(webContentsId)
  fetchEnabled.delete(webContentsId)
}

function pushEntry(webContentsId: number, entry: NetworkEntry): void {
  let buf = buffers.get(webContentsId)
  if (!buf) {
    buf = []
    buffers.set(webContentsId, buf)
  }
  buf.push(entry)
  if (buf.length > BUFFER_CAP) {
    const evicted = buf.splice(0, buf.length - BUFFER_CAP)
    const map = byRequestId.get(webContentsId)
    if (map) for (const e of evicted) map.delete(e.requestId)
  }
}

interface WillBeSent {
  requestId: string
  request: { url: string; method: string }
  type?: string
}
interface ResponseReceived {
  requestId: string
  type?: string
  response: { status: number; statusText: string; mimeType: string }
}
interface LoadingFinished {
  requestId: string
  encodedDataLength?: number
}
interface LoadingFailed {
  requestId: string
  errorText?: string
}
interface RequestPaused {
  requestId: string
  request: { url: string }
}

function handleMessage(webContentsId: number, method: string, params: unknown): void {
  if (method.startsWith('Network.')) {
    handleNetwork(webContentsId, method, params)
  } else if (method === 'Fetch.requestPaused') {
    void handleFetchPaused(webContentsId, params as RequestPaused)
  }
}

function handleNetwork(webContentsId: number, method: string, params: unknown): void {
  let map = byRequestId.get(webContentsId)
  if (!map) {
    map = new Map()
    byRequestId.set(webContentsId, map)
  }
  switch (method) {
    case 'Network.requestWillBeSent': {
      const p = params as WillBeSent
      const entry: NetworkEntry = {
        requestId: p.requestId,
        url: p.request.url,
        method: p.request.method,
        resourceType: p.type,
        status: null,
        finished: false,
      }
      map.set(p.requestId, entry)
      pushEntry(webContentsId, entry)
      break
    }
    case 'Network.responseReceived': {
      const p = params as ResponseReceived
      const e = map.get(p.requestId)
      if (e) {
        e.status = p.response.status
        e.statusText = p.response.statusText
        e.mimeType = p.response.mimeType
        if (p.type) e.resourceType = p.type
      }
      break
    }
    case 'Network.loadingFinished': {
      const p = params as LoadingFinished
      const e = map.get(p.requestId)
      if (e) {
        e.finished = true
        e.size = p.encodedDataLength
      }
      break
    }
    case 'Network.loadingFailed': {
      const p = params as LoadingFailed
      const e = map.get(p.requestId)
      if (e) {
        e.finished = true
        e.failed = true
        e.errorText = p.errorText
      }
      break
    }
  }
}

function ensureListening(webContentsId: number): void {
  if (listening.has(webContentsId)) return
  const wc = ensureAttachedById(webContentsId)
  wc.debugger.on('message', (_e, method, params) => handleMessage(webContentsId, method, params))
  wc.once('destroyed', () => cleanup(webContentsId))
  listening.add(webContentsId)
}

export async function enableNetworkCapture(webContentsId: number): Promise<void> {
  ensureListening(webContentsId)
  await cdpSend(webContentsId, 'Network.enable', {})
}

export interface NetworkQuery {
  urlIncludes?: string
  method?: string
  statusMin?: number
  statusMax?: number
  resourceType?: string
  failedOnly?: boolean
  max?: number
}

function matches(e: NetworkEntry, q: NetworkQuery): boolean {
  if (q.urlIncludes && !e.url.includes(q.urlIncludes)) return false
  if (q.method && e.method.toUpperCase() !== q.method.toUpperCase()) return false
  if (q.resourceType && (e.resourceType ?? '').toLowerCase() !== q.resourceType.toLowerCase()) return false
  if (q.failedOnly && !e.failed) return false
  if (q.statusMin != null && (e.status == null || e.status < q.statusMin)) return false
  if (q.statusMax != null && (e.status == null || e.status > q.statusMax)) return false
  return true
}

const URL_CAP = 256

function capUrl(url: string): string {
  return url.length > URL_CAP ? url.slice(0, URL_CAP) + '…' : url
}

function publicEntry(e: NetworkEntry): Omit<NetworkEntry, 'finished'> {
  return {
    requestId: e.requestId,
    url: capUrl(e.url),
    method: e.method,
    resourceType: e.resourceType,
    status: e.status,
    statusText: e.statusText,
    mimeType: e.mimeType,
    size: e.size,
    failed: e.failed,
    errorText: e.errorText,
  }
}

export function readNetwork(webContentsId: number, query: NetworkQuery = {}): unknown[] {
  const buf = buffers.get(webContentsId) ?? []
  const list = buf.filter((e) => matches(e, query))
  const max = query.max && query.max > 0 ? query.max : 50
  return list.slice(-max).map(publicEntry)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function waitForRequest(webContentsId: number, urlIncludes: string, timeoutMs: number): Promise<unknown | null> {
  const started = Date.now()
  for (;;) {
    const buf = buffers.get(webContentsId) ?? []
    const hit = buf.find((e) => e.url.includes(urlIncludes) && e.finished)
    if (hit) return publicEntry(hit)
    if (Date.now() - started >= timeoutMs) return null
    await sleep(150)
  }
}

export async function getResponseBody(webContentsId: number, urlIncludes: string, maxBytes = 64_000): Promise<{ url: string; body: string; truncated: boolean } | null> {
  const buf = buffers.get(webContentsId) ?? []
  const hit = [...buf].reverse().find((e) => e.url.includes(urlIncludes) && e.finished && !e.failed)
  if (!hit) return null
  const res = await cdpSend<{ body?: string; base64Encoded?: boolean }>(webContentsId, 'Network.getResponseBody', { requestId: hit.requestId })
  let body = res.body ?? ''
  if (res.base64Encoded) body = Buffer.from(body, 'base64').toString('utf-8')
  const truncated = body.length > maxBytes
  return { url: hit.url, body: truncated ? body.slice(0, maxBytes) : body, truncated }
}

async function handleFetchPaused(webContentsId: number, params: RequestPaused): Promise<void> {
  const rules = mockRules.get(webContentsId) ?? []
  const rule = rules.find((r) => params.request.url.includes(r.urlPattern))
  try {
    if (rule) {
      const headerObj: Record<string, string> = { 'Content-Type': rule.contentType, ...rule.headers }
      await cdpSend(webContentsId, 'Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: rule.status,
        responseHeaders: Object.entries(headerObj).map(([name, value]) => ({ name, value })),
        body: Buffer.from(rule.body, 'utf-8').toString('base64'),
      })
    } else {
      await cdpSend(webContentsId, 'Fetch.continueRequest', { requestId: params.requestId })
    }
  } catch (err) {
    log.warn('[browser-cdp] Fetch resume failed wc=%d: %s', webContentsId, err instanceof Error ? err.message : String(err))
  }
}

export async function addMockRule(webContentsId: number, rule: MockRule): Promise<void> {
  if (!isCdpMockEnabled()) throw new Error('Network mocking is disabled. Enable it in Settings → Browser.')
  ensureListening(webContentsId)
  const rules = mockRules.get(webContentsId) ?? []
  rules.push(rule)
  mockRules.set(webContentsId, rules)
  if (!fetchEnabled.has(webContentsId)) {
    await cdpSend(webContentsId, 'Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    fetchEnabled.add(webContentsId)
  }
}

export async function clearMockRules(webContentsId: number): Promise<void> {
  mockRules.delete(webContentsId)
  if (fetchEnabled.has(webContentsId)) {
    await cdpSend(webContentsId, 'Fetch.disable', {}).catch(() => {})
    fetchEnabled.delete(webContentsId)
  }
}
