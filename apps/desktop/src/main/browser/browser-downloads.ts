import { session } from 'electron'
import { createWriteStream } from 'fs'
import { writeFile } from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import log from '../logger'
import { browserAutomationCall } from './browser-automation-bridge'
import { filenameFor, reserveDownloadPath } from '../agent/browser-download-store'

const BROWSER_PARTITION = 'persist:browser'
const MAX_CAPTURED = 20
const POLL_MS = 250

interface CapturedDownload {
  url: string
  filename: string
  path: string
  bytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  webContentsId: number
}

// The capture buffer spans every browser view in the app, so a download is only
// ever reported to the session that owns the tab it came from — otherwise one
// session's agent could read another's downloaded files.
export type DownloadRecord = Omit<CapturedDownload, 'webContentsId'>

export interface DownloadResult {
  path: string
  filename: string
  bytes: number
  mimeType: string
}

const captured: CapturedDownload[] = []
let waiters: Array<() => void> = []

function notifyWaiters(): void {
  const pending = waiters
  waiters = []
  pending.forEach((resolve) => resolve())
}

function parseDataUrl(url: string, fallbackMime: string): { buf: Buffer; mimeType: string } {
  const match = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s)
  if (!match) throw new Error('Invalid data URL')
  const mimeType = match[1] || fallbackMime
  const buf = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8')
  return { buf, mimeType }
}

function nameFromDisposition(disposition: string | null): string {
  if (!disposition) return ''
  const encoded = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1].trim() : ''
}

/**
 * Fetch a URL through the browser's own session, so the request carries the
 * page's cookies/auth and is not subject to CORS. Handles data: URLs inline.
 * Prefer downloadUrl for large files — this buffers the whole body.
 */
export async function fetchBrowserBytes(
  url: string,
  fallbackMime = 'application/octet-stream',
): Promise<{ buf: Buffer; mimeType: string; disposition: string | null }> {
  if (!url) throw new Error('Invalid URL')
  if (url.startsWith('data:')) return { ...parseDataUrl(url, fallbackMime), disposition: null }
  const resp = await session.fromPartition(BROWSER_PARTITION).fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  return {
    buf: Buffer.from(await resp.arrayBuffer()),
    mimeType: resp.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMime,
    disposition: resp.headers.get('content-disposition'),
  }
}

export type DownloadProgress = { bytes: number; totalBytes: number | null; filename: string; mimeType: string }

export async function downloadUrl(
  url: string,
  filenameOverride?: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  if (!url) throw new Error('Invalid URL')
  if (url.startsWith('data:')) {
    const { buf, mimeType } = parseDataUrl(url, 'application/octet-stream')
    const filename = filenameFor(filenameOverride || '', url, mimeType)
    const path = reserveDownloadPath(filename)
    await writeFile(path, buf)
    onProgress?.({ bytes: buf.byteLength, totalBytes: buf.byteLength, filename, mimeType })
    return { path, filename, bytes: buf.byteLength, mimeType }
  }

  const resp = await session.fromPartition(BROWSER_PARTITION).fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
  const disposition = resp.headers.get('content-disposition')
  const filename = filenameFor(filenameOverride || nameFromDisposition(disposition), url, mimeType)
  const path = reserveDownloadPath(filename)
  const totalBytes = Number(resp.headers.get('content-length')) || null

  if (!resp.body) {
    const buf = Buffer.from(await resp.arrayBuffer())
    await writeFile(path, buf)
    onProgress?.({ bytes: buf.byteLength, totalBytes: buf.byteLength, filename, mimeType })
    return { path, filename, bytes: buf.byteLength, mimeType }
  }

  // Stream to disk so multi-MB downloads do not inflate the main process heap.
  const nodeStream = Readable.fromWeb(resp.body as import('stream/web').ReadableStream)
  let received = 0
  let lastEmit = 0
  nodeStream.on('data', (chunk: Buffer | string) => {
    received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    const now = Date.now()
    if (now - lastEmit >= 200 || (totalBytes != null && received >= totalBytes)) {
      lastEmit = now
      onProgress?.({ bytes: received, totalBytes, filename, mimeType })
    }
  })
  await pipeline(nodeStream, createWriteStream(path))
  const { size } = await import('fs/promises').then((fs) => fs.stat(path))
  onProgress?.({ bytes: size, totalBytes: totalBytes ?? size, filename, mimeType })
  return { path, filename, bytes: size, mimeType }
}

/**
 * Capture downloads the page starts on its own (an export button, a download
 * link). Giving the item a save path up front is what suppresses Electron's
 * save dialog — without it a download from an agent-driven page would block on
 * a human. Registered once at boot.
 */
export function registerBrowserDownloadCapture(): void {
  session.fromPartition(BROWSER_PARTITION).on('will-download', (_event, item, webContents) => {
    const filename = filenameFor(item.getFilename(), item.getURL(), item.getMimeType() || '')
    let path: string
    try {
      path = reserveDownloadPath(filename)
    } catch (err) {
      log.warn('[browser-download] failed to reserve a save path', err)
      return
    }
    item.setSavePath(path)

    const record: CapturedDownload = {
      url: item.getURL(),
      filename,
      path,
      bytes: 0,
      state: 'progressing',
      startedAt: Date.now(),
      webContentsId: webContents?.id ?? -1,
    }
    captured.unshift(record)
    captured.length = Math.min(captured.length, MAX_CAPTURED)

    item.once('done', (_doneEvent, state) => {
      record.state = state
      record.bytes = item.getReceivedBytes()
      if (state !== 'completed') log.warn(`[browser-download] ${state}: ${record.url}`)
      notifyWaiters()
    })
    notifyWaiters()
  })
}

function toRecord(d: CapturedDownload): DownloadRecord {
  return {
    url: d.url,
    filename: d.filename,
    path: d.path,
    bytes: d.bytes,
    state: d.state,
    startedAt: d.startedAt,
  }
}

async function ownedWebContentsIds(sessionId: string): Promise<Set<number>> {
  const res = (await browserAutomationCall(sessionId, 'ownedWebContentsIds', {})) as { webContentsIds?: number[] }
  return new Set(res?.webContentsIds ?? [])
}

// Ownership lives in the renderer's browser store (tabs carry an owner session),
// so it is resolved fresh per poll rather than cached: a tab can be opened, or
// change hands, while we wait.
export async function downloadsOwnedBy(sessionId: string): Promise<DownloadRecord[]> {
  const owned = await ownedWebContentsIds(sessionId)
  return captured.filter((d) => owned.has(d.webContentsId)).map(toRecord)
}

function sleepNotify(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== wake)
      resolve()
    }, ms)
    const wake = (): void => {
      clearTimeout(timer)
      resolve()
    }
    waiters.push(wake)
  })
}

export type ListDownloadsState = 'all' | 'progressing' | 'completed' | 'failed'

function matchesState(d: DownloadRecord, state: ListDownloadsState): boolean {
  if (state === 'all') return true
  if (state === 'progressing') return d.state === 'progressing'
  if (state === 'completed') return d.state === 'completed'
  return d.state === 'cancelled' || d.state === 'interrupted'
}

/**
 * Snapshot page-triggered captures for this session (newest first). Optional
 * wait blocks until the condition is met or timeoutMs elapses:
 * - state=progressing: at least one progressing entry
 * - otherwise: at least one matching entry and no owned capture still progressing
 */
export async function listDownloads(
  sessionId: string,
  opts: { state?: ListDownloadsState; wait?: boolean; timeoutMs?: number } = {},
): Promise<DownloadRecord[]> {
  const state = opts.state ?? 'all'
  const wait = opts.wait === true
  const timeoutMs = opts.timeoutMs ?? (wait ? 15000 : 0)
  const deadline = Date.now() + Math.max(0, timeoutMs)

  for (;;) {
    const allOwned = await downloadsOwnedBy(sessionId)
    const snapshot = allOwned.filter((d) => matchesState(d, state))
    if (!wait) return snapshot

    if (state === 'progressing') {
      if (snapshot.length > 0) return snapshot
    } else if (snapshot.length > 0 && !allOwned.some((d) => d.state === 'progressing')) {
      return snapshot
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) return snapshot
    await sleepNotify(Math.min(remaining, POLL_MS))
  }
}

/**
 * Resolve once none of this session's captures are still in flight and at least
 * one exists, or on timeout. Returns newest first.
 */
export async function waitForDownloads(sessionId: string, timeoutMs: number): Promise<DownloadRecord[]> {
  return listDownloads(sessionId, { state: 'all', wait: true, timeoutMs })
}
