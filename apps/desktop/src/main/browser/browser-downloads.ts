import { randomUUID } from 'crypto'
import { BrowserWindow, session } from 'electron'
import { AgentIpcChannels, type BrowserDownloadItem } from '@superone/shared/agent-types'
import { copyFileSync, createWriteStream, unlinkSync } from 'fs'
import { stat, writeFile } from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import log from '../logger'
import { mediaFileGrants } from '../media-file-grants'
import { browserAutomationCall } from './browser-automation-bridge'
import { abandonZoneFile, sealZoneFile } from '../environment/zone-delivery'
import { filenameFor, registerDownload, reserveDownloadPath, wakeDownloadDelivery } from '../agent/browser-download-store'
import { tabDriver, type TabDriver } from './browser-tab-drivers'
import { chromePageDownloads } from './chrome-download-feed'
import { downloadThroughUserChrome } from './chrome-url-download'

const BROWSER_PARTITION = 'persist:browser'
const MAX_CAPTURED = 20
const POLL_MS = 250
const PROGRESS_BROADCAST_MS = 150

interface CapturedDownload {
  id: string
  url: string
  filename: string
  path: string
  bytes: number
  totalBytes: number
  paused: boolean
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  completedAt?: number
  webContentsId: number
  /** The session that drove the tab when the download started, if known. */
  driver: TabDriver | null
}

// The capture buffer spans every browser view in the app, so a download is only
// ever reported to the session that owns the tab it came from — otherwise one
// session's agent could read another's downloaded files.
export type DownloadRecord = Pick<CapturedDownload, 'url' | 'filename' | 'path' | 'bytes' | 'state' | 'startedAt'>

export interface DownloadResult {
  path: string
  filename: string
  bytes: number
  mimeType: string
}

const captured: CapturedDownload[] = []
const activeItems = new Map<string, Electron.DownloadItem>()
let waiters: Array<() => void> = []

function toUiRecord(record: CapturedDownload): BrowserDownloadItem {
  return {
    id: record.id,
    url: record.url,
    filename: record.filename,
    path: record.path,
    receivedBytes: record.bytes,
    totalBytes: record.totalBytes,
    state: record.state,
    paused: record.paused,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  }
}

function broadcastDownload(record: CapturedDownload): void {
  const payload = toUiRecord(record)
  for (const win of BrowserWindow?.getAllWindows?.() ?? []) {
    if (!win.isDestroyed()) {
      win.webContents.send(AgentIpcChannels.BROWSER_DOWNLOAD_STATE, payload)
    }
  }
}

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

export interface DownloadUrlOptions {
  /** Override the saved file name. Defaults to Content-Disposition or the URL path. */
  filename?: string
  /** Absolute directory to save into. Defaults to the configured download directory. */
  dir?: string | null
  /**
   * Session the download belongs to. A remote session's file lands in its sync
   * zone and is registered so the Host Action pushes it to the node
   * (`docs/architecture/session-sync-zone.md` §6); a local session is unaffected.
   */
  sessionId?: string | null
  onProgress?: (p: DownloadProgress) => void
}

export async function downloadUrl(url: string, opts: DownloadUrlOptions = {}): Promise<DownloadResult> {
  const { filename: filenameOverride, dir, sessionId, onProgress } = opts
  if (!url) throw new Error('Invalid URL')
  if (url.startsWith('data:')) {
    const { buf, mimeType } = parseDataUrl(url, 'application/octet-stream')
    const filename = filenameFor(filenameOverride || '', url, mimeType)
    const path = reserveDownloadPath(filename, dir, sessionId)
    try {
      await writeFile(path, buf)
    } catch (err) {
      // The reservation claimed the path against the mirror; a write that never
      // happened must give it back or the file is protected forever.
      if (sessionId) abandonZoneFile(sessionId, path)
      throw err
    }
    onProgress?.({ bytes: buf.byteLength, totalBytes: buf.byteLength, filename, mimeType })
    mediaFileGrants().add(path)
    registerDownload(sessionId, path, true)
    return { path, filename, bytes: buf.byteLength, mimeType }
  }

  const viaChrome = await downloadThroughUserChrome({ sessionId, url, filename: filenameOverride })
  if (viaChrome) {
    const mimeType = viaChrome.mimeType || 'application/octet-stream'
    const filename = filenameFor(filenameOverride || viaChrome.filename, url, mimeType)
    const path = reserveDownloadPath(filename, dir, sessionId)
    try {
      copyFileSync(viaChrome.path, path)
    } catch (err) {
      if (sessionId) abandonZoneFile(sessionId, path)
      try { unlinkSync(path) } catch { /* the empty reservation may already be gone */ }
      throw err
    }
    const { size } = await stat(path)
    onProgress?.({ bytes: size, totalBytes: size, filename, mimeType })
    mediaFileGrants().add(path)
    registerDownload(sessionId, path, true)
    return { path, filename, bytes: size, mimeType }
  }

  const resp = await session.fromPartition(BROWSER_PARTITION).fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
  const disposition = resp.headers.get('content-disposition')
  const filename = filenameFor(filenameOverride || nameFromDisposition(disposition), url, mimeType)
  const path = reserveDownloadPath(filename, dir, sessionId)
  const totalBytes = Number(resp.headers.get('content-length')) || null

  try {
    return await receiveBody()
  } catch (err) {
    if (sessionId) abandonZoneFile(sessionId, path)
    throw err
  }

  async function receiveBody(): Promise<DownloadResult> {
  if (!resp.body) {
    const buf = Buffer.from(await resp.arrayBuffer())
    await writeFile(path, buf)
    onProgress?.({ bytes: buf.byteLength, totalBytes: buf.byteLength, filename, mimeType })
    mediaFileGrants().add(path)
    registerDownload(sessionId, path, true)
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
  mediaFileGrants().add(path)
  registerDownload(sessionId, path, true)
  return { path, filename, bytes: size, mimeType }
  }
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
    // Ownership is renderer state behind an async call and this handler must
    // answer now; the session that last drove the tab is known synchronously
    // and is the one whose agent clicked. A remote session's file goes into
    // its zone so the agent can open it; a local session's into Downloads.
    const driver = tabDriver(webContents?.id)
    let path: string
    try {
      path = driver
        ? reserveDownloadPath(filename, null, driver.sessionId, { connectionId: driver.connectionId })
        : reserveDownloadPath(filename)
    } catch (err) {
      // The reservation is now strict: the delivery record could not be written,
      // or the session's zone was dropped. Returning here would let Electron
      // fall back to its default save flow — a dialog, or an untracked file in
      // the user's Downloads that a remote agent can never see (E090-6). Cancel
      // the download instead, and record the failure for `waitForDownloads`.
      log.warn('[browser-download] refused to reserve a save path; cancelling', err)
      try { item.cancel() } catch (cancelErr) { log.debug('[browser-download] could not cancel a refused download', cancelErr) }
      const failed: CapturedDownload = {
        id: randomUUID(),
        url: item.getURL(),
        filename,
        path: '',
        bytes: 0,
        totalBytes: 0,
        paused: false,
        state: 'interrupted',
        startedAt: Date.now(),
        completedAt: Date.now(),
        webContentsId: webContents?.id ?? -1,
        driver,
      }
      captured.unshift(failed)
      captured.length = Math.min(captured.length, MAX_CAPTURED)
      broadcastDownload(failed)
      notifyWaiters()
      return
    }
    item.setSavePath(path)

    const id = randomUUID()
    const record: CapturedDownload = {
      id,
      url: item.getURL(),
      filename,
      path,
      bytes: item.getReceivedBytes?.() ?? 0,
      totalBytes: item.getTotalBytes?.() ?? 0,
      paused: item.isPaused?.() ?? false,
      state: 'progressing',
      startedAt: Date.now(),
      webContentsId: webContents?.id ?? -1,
      driver,
    }
    captured.unshift(record)
    captured.length = Math.min(captured.length, MAX_CAPTURED)
    activeItems.set(id, item)
    broadcastDownload(record)

    let progressTimer: ReturnType<typeof setTimeout> | null = null
    const flushProgress = (): void => {
      if (progressTimer) {
        clearTimeout(progressTimer)
        progressTimer = null
      }
      broadcastDownload(record)
    }

    item.on?.('updated', (_updateEvent, updateState) => {
      record.bytes = item.getReceivedBytes?.() ?? record.bytes
      record.totalBytes = item.getTotalBytes?.() ?? record.totalBytes
      const paused = item.isPaused?.() ?? false
      const pausedChanged = record.paused !== paused
      record.paused = paused
      if (updateState === 'interrupted') {
        record.state = 'interrupted'
        flushProgress()
        return
      }
      if (pausedChanged) {
        flushProgress()
        return
      }
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = null
          broadcastDownload(record)
        }, PROGRESS_BROADCAST_MS)
      }
    })

    item.once('done', (_doneEvent, state) => {
      if (progressTimer) {
        clearTimeout(progressTimer)
        progressTimer = null
      }
      activeItems.delete(id)
      record.state = state
      record.bytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes?.() ?? record.totalBytes
      record.paused = false
      record.completedAt = Date.now()
      if (state === 'completed') {
        try { mediaFileGrants().add(path) } catch (error) { log.warn('[browser-download] could not persist media grant', error) }
        // The delivery record is sealed HERE, by the item's own completion —
        // not by a later listing that may never come. Its node was named at
        // reservation, from the tab driver; a local session's file has no
        // row. Outside any tool call, so the worker carries it, and its
        // completion wake is how the agent learns the node path works.
        if (driver) {
          try {
            sealZoneFile({ sessionId: driver.sessionId, path, origin: 'page-download', connectionId: driver.connectionId })
            if (driver.connectionId) wakeDownloadDelivery(driver.connectionId)
          } catch (err) {
            // The session let go of the reservation while the bytes came in:
            // nothing will carry them, and the listing must not say otherwise.
            record.state = 'interrupted'
            log.warn(`[browser-download] completed but not deliverable: ${record.url}`, err)
          }
        }
      }
      if (state !== 'completed') {
        log.warn(`[browser-download] ${state}: ${record.url}`)
        // Cancelled or interrupted: there is nothing to hand on, and holding
        // the row would pin a stub the mirror may never prune.
        if (driver) abandonZoneFile(driver.sessionId, path)
      }
      broadcastDownload(record)
      notifyWaiters()
    })
    notifyWaiters()
  })
}

export function listBrowserDownloads(): BrowserDownloadItem[] {
  return captured.map(toUiRecord)
}

export function cancelBrowserDownload(id: string): boolean {
  const item = activeItems.get(id)
  if (!item) return false
  try {
    item.cancel()
    return true
  } catch {
    return false
  }
}

export function clearBrowserDownloads(id?: string): BrowserDownloadItem[] {
  for (let i = captured.length - 1; i >= 0; i--) {
    const entry = captured[i]
    if (entry.state === 'progressing') continue
    if (!id || entry.id === id) captured.splice(i, 1)
  }
  return captured.map(toUiRecord)
}

export function hasBrowserDownloadPath(filePath: string): boolean {
  return Boolean(filePath) && captured.some((entry) => entry.path === filePath)
}

function toRecord({ url, filename, path, bytes, state, startedAt }: CapturedDownload): DownloadRecord {
  return { url, filename, path, bytes, state, startedAt }
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
  const chrome = chromePageDownloads()
    .filter((download) => owned.has(download.webContentsId))
    .map(({ webContentsId: _webContentsId, guid: _guid, ...record }) => record)
  return [...captured.filter((d) => owned.has(d.webContentsId)).map(toRecord), ...chrome]
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
