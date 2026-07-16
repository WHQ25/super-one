import { describe, it, expect, vi, beforeEach } from 'vitest'

type WillDownloadHandler = (event: unknown, item: FakeItem, webContents: { id: number }) => void

const sessionOn = vi.fn<(event: string, handler: WillDownloadHandler) => void>()

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ on: sessionOn, fetch: vi.fn() }) },
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn() }))

vi.mock('../agent/browser-download-store', () => ({
  filenameFor: (raw: string) => raw,
  reserveDownloadPath: (name: string) => `/tmp/dl/${name}`,
}))

import { browserAutomationCall } from './browser-automation-bridge'

let listDownloads: typeof import('./browser-downloads').listDownloads
let waitForDownloads: typeof import('./browser-downloads').waitForDownloads

class FakeItem {
  private doneHandler?: (event: unknown, state: string) => void
  savePath = ''
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
    return 32
  }
  setSavePath(p: string): void {
    this.savePath = p
  }
  once(_event: string, handler: (event: unknown, state: string) => void): void {
    this.doneHandler = handler
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
    mod.registerBrowserDownloadCapture()
  })

  it('gives the item a save path so Electron never opens a save dialog', () => {
    const item = emitDownload('a.txt', 10)
    expect(item.savePath).toBe('/tmp/dl/a.txt')
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

  it('lists multiple concurrent page captures without exclusive claiming', async () => {
    emitDownload('a.txt', 10).finish()
    emitDownload('b.txt', 10).finish()
    ownTabs(10)

    const all = await listDownloads('sess-1')
    expect(all.map((d) => d.filename)).toEqual(['b.txt', 'a.txt'])
  })
})
