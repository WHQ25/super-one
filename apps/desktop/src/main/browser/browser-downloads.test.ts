import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

type WillDownloadHandler = (event: unknown, item: FakeItem, webContents: { id: number }) => void

const sessionOn = vi.fn<(event: string, handler: WillDownloadHandler) => void>()

const sendMock = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/superone-test-userData' },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: sendMock } }],
  },
  session: { fromPartition: () => ({ on: sessionOn, fetch: vi.fn() }) },
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn() }))

const chromeDownload = vi.hoisted(() => ({ downloadThroughUserChrome: vi.fn(async () => null as null | { path: string; filename: string; bytes: number; mimeType: string; state: 'completed' }) }))
vi.mock('./chrome-url-download', () => chromeDownload)

const store = vi.hoisted(() => ({
  reserveDownloadPath: vi.fn((name: string, _dir?: string | null, sessionId?: string | null, origin?: { connectionId: string | null }) =>
    origin?.connectionId ? `/zone/${sessionId}/download/${name}` : `/tmp/dl/${name}`),
  registerDownload: vi.fn(),
  wakeDownloadDelivery: vi.fn(),
}))
vi.mock('../agent/browser-download-store', () => ({
  filenameFor: (raw: string) => raw,
  reserveDownloadPath: store.reserveDownloadPath,
  registerDownload: store.registerDownload,
  wakeDownloadDelivery: store.wakeDownloadDelivery,
}))

// The delivery record is sealed on completion and abandoned on give-up; the
// capture path names its node from the tab driver and wakes the worker.
const record = vi.hoisted(() => ({ sealZoneFile: vi.fn(), abandonZoneFile: vi.fn() }))
vi.mock('../environment/zone-delivery', () => ({
  sealZoneFile: record.sealZoneFile,
  abandonZoneFile: record.abandonZoneFile,
}))

import { browserAutomationCall } from './browser-automation-bridge'

let listDownloads: typeof import('./browser-downloads').listDownloads
let waitForDownloads: typeof import('./browser-downloads').waitForDownloads
let downloadUrl: typeof import('./browser-downloads').downloadUrl
let listBrowserDownloads: typeof import('./browser-downloads').listBrowserDownloads
let cancelBrowserDownload: typeof import('./browser-downloads').cancelBrowserDownload
let clearBrowserDownloads: typeof import('./browser-downloads').clearBrowserDownloads
let hasBrowserDownloadPath: typeof import('./browser-downloads').hasBrowserDownloadPath
// Re-imported with the module under test: `resetModules` gives each test a
// fresh driver map, and the one the capture reads must be the one we fill.
let rememberTabDriver: typeof import('./browser-tab-drivers').rememberTabDriver

class FakeItem {
  private doneHandler?: (event: unknown, state: string) => void
  private updateHandler?: (event: unknown, state: string) => void
  savePath = ''
  receivedBytes = 0
  totalBytes = 100
  paused = false
  constructor(
    private readonly filename: string,
    private readonly url: string,
  ) {}
  getFilename(): string {
    return this.filename
  }
  getURL(): string {
    return this.url
  }
  getMimeType(): string {
    return 'text/plain'
  }
  getReceivedBytes(): number {
    return this.receivedBytes || 32
  }
  getTotalBytes(): number {
    return this.totalBytes
  }
  isPaused(): boolean {
    return this.paused
  }
  cancelled = false
  setSavePath(p: string): void {
    this.savePath = p
  }
  cancel(): void {
    this.cancelled = true
  }
  on(event: string, handler: (event: unknown, state: string) => void): void {
    if (event === 'updated') this.updateHandler = handler
  }
  once(_event: string, handler: (event: unknown, state: string) => void): void {
    this.doneHandler = handler
  }
  progress(received: number, total = 100): void {
    this.receivedBytes = received
    this.totalBytes = total
    this.updateHandler?.(null, 'progressing')
  }
  finish(state = 'completed'): void {
    this.doneHandler?.(null, state)
  }
}

function emitDownload(filename: string, webContentsId: number): FakeItem {
  const handler = sessionOn.mock.calls.find(([event]) => event === 'will-download')![1]
  const item = new FakeItem(filename, `https://x.test/${filename}`)
  handler(null, item, { id: webContentsId })
  return item
}

function ownTabs(...webContentsIds: number[]): void {
  vi.mocked(browserAutomationCall).mockResolvedValue({ webContentsIds })
}

describe('page-triggered download capture', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import('./browser-downloads')
    listDownloads = mod.listDownloads
    waitForDownloads = mod.waitForDownloads
    downloadUrl = mod.downloadUrl
    listBrowserDownloads = mod.listBrowserDownloads
    cancelBrowserDownload = mod.cancelBrowserDownload
    clearBrowserDownloads = mod.clearBrowserDownloads
    hasBrowserDownloadPath = mod.hasBrowserDownloadPath
    rememberTabDriver = (await import('./browser-tab-drivers')).rememberTabDriver
    mod.registerBrowserDownloadCapture()
  })

  it('gives the item a save path so Electron never opens a save dialog', () => {
    const item = emitDownload('a.txt', 10)
    expect(item.savePath).toBe('/tmp/dl/a.txt')
  })

  it('files a download the page starts in a tab a remote session drives into that session zone, and wakes the worker', async () => {
    // `will-download` is synchronous and tab ownership is renderer state, so
    // the capture asks who last *drove* the tab instead — every browser tool
    // call records that. A remote session's agent then finds the file in its
    // own directory without listing first, and the delivery's wake names it.
    rememberTabDriver(10, 'sess-1', 'conn-1')
    const item = emitDownload('export.csv', 10)
    expect(item.savePath).toBe('/zone/sess-1/download/export.csv')
    expect(store.reserveDownloadPath).toHaveBeenCalledWith('export.csv', null, 'sess-1', { connectionId: 'conn-1' })
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    item.finish()
    expect(record.sealZoneFile).toHaveBeenCalledWith({ sessionId: 'sess-1', path: '/zone/sess-1/download/export.csv', origin: 'page-download', connectionId: 'conn-1' })
    expect(store.wakeDownloadDelivery).toHaveBeenCalledWith('conn-1')
  })

  it('keeps a local session download in the Downloads folder, and an undriven tab too', () => {
    rememberTabDriver(11, 'sess-local', null)
    expect(emitDownload('a.txt', 11).savePath).toBe('/tmp/dl/a.txt')
    expect(emitDownload('b.txt', 12).savePath).toBe('/tmp/dl/b.txt')
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    expect(store.wakeDownloadDelivery).not.toHaveBeenCalled()
  })

  it('abandons the reservation of a remote download that was cancelled or interrupted', () => {
    rememberTabDriver(10, 'sess-1', 'conn-1')
    emitDownload('half.bin', 10).finish('interrupted')
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    expect(record.abandonZoneFile).toHaveBeenCalledWith('sess-1', '/zone/sess-1/download/half.bin')
  })

  it('cancels a download whose reservation is refused, saves nowhere, and records the failure for a waiter (E090-6)', async () => {
    // `will-download` is synchronous: returning without a save path hands the
    // item back to Electron, which opens a save dialog or drops an untracked
    // file into Downloads a remote agent can never reach. When the now-strict
    // reservation throws (the delivery row could not be written, or the zone was
    // dropped), the capture must cancel the item, set no save path, and record
    // the failure so `waitForDownloads` resolves on it instead of hanging.
    rememberTabDriver(10, 'sess-1', 'conn-1')
    ownTabs(10)
    store.reserveDownloadPath.mockImplementationOnce(() => { throw new Error('zone dropped') })
    const item = emitDownload('report.pdf', 10)
    // Cancelled, and Electron was given no default save flow to fall back to.
    expect(item.cancelled).toBe(true)
    expect(item.savePath).toBe('')
    // Nothing was sealed — the reservation never succeeded.
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    // The failure is a terminal capture a waiter sees: interrupted, no bytes, no path.
    const visible = await waitForDownloads('sess-1', 2000)
    expect(visible).toMatchObject([{ filename: 'report.pdf', state: 'interrupted', path: '', bytes: 0 }])
  })

  it('lists only downloads from tabs the calling session owns', async () => {
    const mine = emitDownload('mine.txt', 10)
    const theirs = emitDownload('theirs.txt', 99)
    mine.finish()
    theirs.finish()

    ownTabs(10)
    const visible = await listDownloads('sess-1')

    expect(visible.map((d) => d.filename)).toEqual(['mine.txt'])
  })

  it('hides every capture from a session that owns no browser tab', async () => {
    emitDownload('secret.txt', 10).finish()

    ownTabs()
    const visible = await listDownloads('sess-other', { wait: true, timeoutMs: 300 })

    expect(visible).toEqual([])
  })

  it('does not leak the internal webContents id to the model', async () => {
    emitDownload('a.txt', 10).finish()

    ownTabs(10)
    const [record] = await listDownloads('sess-1')

    expect(record).not.toHaveProperty('webContentsId')
    expect(record).toMatchObject({ filename: 'a.txt', path: '/tmp/dl/a.txt', bytes: 32, state: 'completed' })
  })

  it('wait resolves when this session has a terminal capture', async () => {
    const mine = emitDownload('mine.txt', 10)
    emitDownload('slow-theirs.txt', 99)
    ownTabs(10)

    const pending = waitForDownloads('sess-1', 2000)
    mine.finish()
    const visible = await pending

    expect(visible.map((d) => d.filename)).toEqual(['mine.txt'])
    expect(visible[0].state).toBe('completed')
  })

  it('filters by state', async () => {
    emitDownload('done.txt', 10).finish()
    emitDownload('fail.txt', 10).finish('interrupted')
    emitDownload('busy.txt', 10)
    ownTabs(10)

    expect((await listDownloads('sess-1', { state: 'completed' })).map((d) => d.filename)).toEqual(['done.txt'])
    expect((await listDownloads('sess-1', { state: 'failed' })).map((d) => d.filename)).toEqual(['fail.txt'])
    expect((await listDownloads('sess-1', { state: 'progressing' })).map((d) => d.filename)).toEqual(['busy.txt'])
  })

  it('returns newest first', async () => {
    emitDownload('first.txt', 10).finish()
    emitDownload('second.txt', 10).finish()

    ownTabs(10)
    const visible = await listDownloads('sess-1')

    expect(visible.map((d) => d.filename)).toEqual(['second.txt', 'first.txt'])
  })

  it('copies a Chrome download into the reserved path and grants that copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chrome-dl-'))
    const source = join(dir, 'from-chrome.txt')
    writeFileSync(source, 'hello')
    store.reserveDownloadPath.mockImplementationOnce((name: string) => join(dir, name))
    chromeDownload.downloadThroughUserChrome.mockResolvedValueOnce({
      path: source,
      filename: 'a.txt',
      bytes: 5,
      mimeType: 'text/plain',
      state: 'completed',
    })
    try {
      const result = await downloadUrl('https://x.test/a.txt', { sessionId: 'sess-1', filename: 'a.txt' })
      expect(result).toMatchObject({ path: join(dir, 'a.txt'), filename: 'a.txt', bytes: 5, mimeType: 'text/plain' })
      expect(readFileSync(result.path, 'utf8')).toBe('hello')
      expect(store.registerDownload).toHaveBeenCalledWith('sess-1', join(dir, 'a.txt'), true)
      expect(chromeDownload.downloadThroughUserChrome).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        url: 'https://x.test/a.txt',
        filename: 'a.txt',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('abandons the reservation when the Chrome file cannot be copied', async () => {
    chromeDownload.downloadThroughUserChrome.mockResolvedValueOnce({
      path: '/no/such/chrome-download.txt',
      filename: 'a.txt',
      bytes: 0,
      mimeType: 'text/plain',
      state: 'completed',
    })
    await expect(downloadUrl('https://x.test/a.txt', { sessionId: 'sess-1', filename: 'a.txt' })).rejects.toThrow()
    expect(record.abandonZoneFile).toHaveBeenCalledWith('sess-1', '/tmp/dl/a.txt')
  })

  it('lists multiple concurrent page captures without exclusive claiming', async () => {
    emitDownload('a.txt', 10).finish()
    emitDownload('b.txt', 10).finish()
    ownTabs(10)

    const all = await listDownloads('sess-1')
    expect(all.map((d) => d.filename)).toEqual(['b.txt', 'a.txt'])
  })

  it('exposes UI download snapshots, supports cancel and clear, and checks paths', () => {
    const first = emitDownload('archive.zip', 10)
    first.progress(50, 200)
    const second = emitDownload('done.pdf', 10)
    second.finish('completed')

    const list = listBrowserDownloads()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ filename: 'done.pdf', state: 'completed' })
    expect(list[1]).toMatchObject({ filename: 'archive.zip', state: 'progressing', receivedBytes: 50, totalBytes: 200 })
    expect(hasBrowserDownloadPath('/tmp/dl/done.pdf')).toBe(true)
    expect(hasBrowserDownloadPath('/tmp/dl/unknown.pdf')).toBe(false)

    expect(cancelBrowserDownload(list[1].id)).toBe(true)
    expect(first.cancelled).toBe(true)
    expect(cancelBrowserDownload('missing-id')).toBe(false)

    const remaining = clearBrowserDownloads()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].filename).toBe('archive.zip')
    expect(sendMock).toHaveBeenCalled()
  })
})
