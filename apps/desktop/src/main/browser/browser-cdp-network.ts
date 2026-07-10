import { randomUUID } from 'crypto'
import { ensureAttachedById, cdpSend, isCdpMockEnabled } from './browser-cdp'
import log from '../logger'

// On-demand, scoped network recording. Nothing is captured unless an agent
// explicitly starts a recording; capture is torn down when the last recording
// on a tab stops. Response bodies are fetched EAGERLY at loadingFinished (while
// still in Chromium's buffer) into our own budgeted store — so a later read is
// never subject to the inspector-cache eviction race.

const DEFAULT_RESOURCE_TYPES = ['xhr', 'fetch']
const DEFAULT_MAX = 200
const PER_BODY_CAP = 5 * 1024 * 1024
const RECORDING_BODY_BUDGET = 64 * 1024 * 1024
const HEADER_VALUE_CAP = 4096
const NETWORK_ENABLE_ARGS = { maxResourceBufferSize: 32 * 1024 * 1024, maxTotalBufferSize: 64 * 1024 * 1024 }

export interface RecordedRequest {
  requestId: string
  url: string
  method: string
  resourceType?: string
  status: number | null
  statusText?: string
  mimeType?: string
  encodedSize?: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  body?: string
  bodyTruncated?: boolean
  bodyOmitted?: 'budget' | 'not-captured' | 'error'
  finished: boolean
  failed?: boolean
  errorText?: string
}

interface Recording {
  id: string
  webContentsId: number
  active: boolean
  match?: string
  resourceTypes: Set<string> | null
  captureBodies: boolean
  max: number
  entries: Map<string, RecordedRequest>
  order: string[]
  bodyBudgetLeft: number
  pending: Set<Promise<void>>
}

// Recordings live in `recordings` for their whole lifetime so bodies stay
// readable after stop. `activeByWc` holds only capturing recordings (drives
// event fan-out + the Network.enable refcount). Stopped recordings are retained
// (bodies still readable on demand) under a small LRU so memory stays bounded.
const RETAINED_CAP = 3
const recordings = new Map<string, Recording>()
const activeByWc = new Map<number, Set<string>>()
const retainedOrder: string[] = []
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
  for (const [id, rec] of recordings) {
    if (rec.webContentsId !== webContentsId) continue
    recordings.delete(id)
    const idx = retainedOrder.indexOf(id)
    if (idx !== -1) retainedOrder.splice(idx, 1)
  }
  activeByWc.delete(webContentsId)
  listening.delete(webContentsId)
  mockRules.delete(webContentsId)
  fetchEnabled.delete(webContentsId)
}

function capHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const k in headers) {
    const v = headers[k]
    out[k] = v != null && v.length > HEADER_VALUE_CAP ? v.slice(0, HEADER_VALUE_CAP) + '…' : v
  }
  return out
}

interface WillBeSent {
  requestId: string
  request: { url: string; method: string; headers?: Record<string, string>; postData?: string }
  type?: string
}
interface ResponseReceived {
  requestId: string
  type?: string
  response: { status: number; statusText: string; mimeType: string; headers?: Record<string, string> }
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

function matchesRecording(rec: Recording, url: string, type?: string): boolean {
  if (rec.match && !url.includes(rec.match)) return false
  if (rec.resourceTypes && !rec.resourceTypes.has((type ?? '').toLowerCase())) return false
  return true
}

function activeRecordings(webContentsId: number): Recording[] {
  const ids = activeByWc.get(webContentsId)
  if (!ids) return []
  const list: Recording[] = []
  for (const id of ids) {
    const rec = recordings.get(id)
    if (rec) list.push(rec)
  }
  return list
}

function handleMessage(webContentsId: number, method: string, params: unknown): void {
  if (method.startsWith('Network.')) {
    handleNetwork(webContentsId, method, params)
  } else if (method === 'Fetch.requestPaused') {
    void handleFetchPaused(webContentsId, params as RequestPaused)
  }
}

function handleNetwork(webContentsId: number, method: string, params: unknown): void {
  const recs = activeRecordings(webContentsId)
  if (!recs.length) return
  switch (method) {
    case 'Network.requestWillBeSent': {
      const p = params as WillBeSent
      for (const rec of recs) {
        if (rec.entries.has(p.requestId)) continue
        if (!matchesRecording(rec, p.request.url, p.type)) continue
        if (rec.order.length >= rec.max) continue
        const entry: RecordedRequest = {
          requestId: p.requestId,
          url: p.request.url,
          method: p.request.method,
          resourceType: p.type,
          status: null,
          requestHeaders: capHeaders(p.request.headers),
          requestBody: p.request.postData,
          finished: false,
        }
        rec.entries.set(p.requestId, entry)
        rec.order.push(p.requestId)
      }
      break
    }
    case 'Network.responseReceived': {
      const p = params as ResponseReceived
      for (const rec of recs) {
        const e = rec.entries.get(p.requestId)
        if (!e) continue
        e.status = p.response.status
        e.statusText = p.response.statusText
        e.mimeType = p.response.mimeType
        e.responseHeaders = capHeaders(p.response.headers)
        if (p.type) e.resourceType = p.type
      }
      break
    }
    case 'Network.loadingFinished': {
      const p = params as LoadingFinished
      for (const rec of recs) {
        const e = rec.entries.get(p.requestId)
        if (!e) continue
        e.finished = true
        e.encodedSize = p.encodedDataLength
        if (rec.captureBodies) captureBody(rec, e)
      }
      break
    }
    case 'Network.loadingFailed': {
      const p = params as LoadingFailed
      for (const rec of recs) {
        const e = rec.entries.get(p.requestId)
        if (!e) continue
        e.finished = true
        e.failed = true
        e.errorText = p.errorText
      }
      break
    }
  }
}

// Eagerly pull the body into our own store while it's still buffered. The
// promise is tracked so stop()/wait() can await in-flight fetches.
function captureBody(rec: Recording, entry: RecordedRequest): void {
  if (rec.bodyBudgetLeft <= 0) {
    entry.bodyOmitted = 'budget'
    return
  }
  let p!: Promise<void>
  p = (async () => {
    try {
      const res = await cdpSend<{ body?: string; base64Encoded?: boolean }>(rec.webContentsId, 'Network.getResponseBody', { requestId: entry.requestId })
      let body = res.body ?? ''
      if (res.base64Encoded) body = Buffer.from(body, 'base64').toString('utf-8')
      const perBodyTruncated = body.length > PER_BODY_CAP
      if (perBodyTruncated) body = body.slice(0, PER_BODY_CAP)
      const budgetTruncated = body.length > rec.bodyBudgetLeft
      if (budgetTruncated) body = body.slice(0, rec.bodyBudgetLeft)
      rec.bodyBudgetLeft -= body.length
      entry.body = body
      if (perBodyTruncated || budgetTruncated) entry.bodyTruncated = true
    } catch {
      // The document body is consumed by the renderer, and some responses are
      // never retained; mark it rather than failing the whole recording.
      entry.bodyOmitted = 'error'
    } finally {
      rec.pending.delete(p)
    }
  })()
  rec.pending.add(p)
}

function ensureListening(webContentsId: number): void {
  if (listening.has(webContentsId)) return
  const wc = ensureAttachedById(webContentsId)
  wc.debugger.on('message', (_e, method, params) => handleMessage(webContentsId, method, params))
  wc.once('destroyed', () => cleanup(webContentsId))
  listening.add(webContentsId)
}

export interface StartRecordingOptions {
  match?: string
  resourceTypes?: string[]
  captureBodies?: boolean
  max?: number
}

export async function startRecording(webContentsId: number, opts: StartRecordingOptions = {}): Promise<string> {
  ensureListening(webContentsId)
  const firstOnTab = !activeByWc.has(webContentsId) || activeByWc.get(webContentsId)!.size === 0
  if (firstOnTab) await cdpSend(webContentsId, 'Network.enable', NETWORK_ENABLE_ARGS)
  const types = opts.resourceTypes && opts.resourceTypes.length ? opts.resourceTypes : DEFAULT_RESOURCE_TYPES
  const rec: Recording = {
    id: randomUUID(),
    webContentsId,
    active: true,
    match: opts.match,
    resourceTypes: types.includes('*') ? null : new Set(types.map((t) => t.toLowerCase())),
    captureBodies: opts.captureBodies !== false,
    max: opts.max && opts.max > 0 ? opts.max : DEFAULT_MAX,
    entries: new Map(),
    order: [],
    bodyBudgetLeft: RECORDING_BODY_BUDGET,
    pending: new Set(),
  }
  recordings.set(rec.id, rec)
  let ids = activeByWc.get(webContentsId)
  if (!ids) {
    ids = new Set()
    activeByWc.set(webContentsId, ids)
  }
  ids.add(rec.id)
  return rec.id
}

// Retire a stopped recording into the bounded LRU (bodies stay readable).
function retain(recordingId: string): void {
  const existing = retainedOrder.indexOf(recordingId)
  if (existing !== -1) retainedOrder.splice(existing, 1)
  retainedOrder.push(recordingId)
  while (retainedOrder.length > RETAINED_CAP) {
    const evicted = retainedOrder.shift()!
    recordings.delete(evicted)
  }
}

async function drainAndSnapshot(rec: Recording): Promise<RecordedRequest[]> {
  if (rec.pending.size) await Promise.allSettled([...rec.pending])
  return rec.order.map((id) => rec.entries.get(id)!).filter(Boolean)
}

export async function stopRecording(recordingId: string, keep = false): Promise<RecordedRequest[] | null> {
  const rec = recordings.get(recordingId)
  if (!rec) return null
  const snapshot = await drainAndSnapshot(rec)
  if (!keep && rec.active) {
    rec.active = false
    const ids = activeByWc.get(rec.webContentsId)
    if (ids) {
      ids.delete(recordingId)
      if (ids.size === 0) {
        activeByWc.delete(rec.webContentsId)
        await cdpSend(rec.webContentsId, 'Network.disable', {}).catch(() => {})
      }
    }
    retain(recordingId)
  }
  return snapshot
}

// Read one recorded request's full detail on demand (from our retained store —
// never the volatile inspector cache), by the requestId carried in the manifest.
// This is where headers, request payload, and the full response body live; the
// stop/wait manifest stays a lean, uniform scan table.
export function getRecordedRequest(recordingId: string, requestId: string): RecordedRequest | null {
  const rec = recordings.get(recordingId)
  if (!rec) return null
  return rec.entries.get(requestId) ?? null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function waitForRecordedRequest(recordingId: string, urlIncludes: string, timeoutMs: number): Promise<RecordedRequest | null> {
  const started = Date.now()
  for (;;) {
    const rec = recordings.get(recordingId)
    if (!rec) return null
    const hitId = rec.order.find((id) => {
      const e = rec.entries.get(id)
      return e && e.finished && e.url.includes(urlIncludes)
    })
    if (hitId) {
      if (rec.pending.size) await Promise.allSettled([...rec.pending])
      return rec.entries.get(hitId) ?? null
    }
    if (Date.now() - started >= timeoutMs) return null
    await sleep(150)
  }
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
