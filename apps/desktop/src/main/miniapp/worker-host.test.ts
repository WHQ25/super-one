import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sentToShell: Array<{ channel: string; data: unknown }> = []
const sentToMain: Array<{ channel: string; data: unknown }> = []

class FakeWebContents {
  send = vi.fn((channel: string, data: unknown) => { sentToShell.push({ channel, data }) })
  setWindowOpenHandler = vi.fn()
  on = vi.fn()
}
class FakeWindow {
  webContents = new FakeWebContents()
  destroyed = false
  on = vi.fn()
  loadURL = vi.fn()
  loadFile = vi.fn()
  isDestroyed = () => this.destroyed
  destroy = vi.fn(() => { this.destroyed = true })
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  session: {
    fromPartition: () => ({
      protocol: { handle: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }),
  },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./miniapp-protocol', () => ({ registerMiniAppProtocolHandlers: vi.fn() }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const wh = await import('./worker-host')

const mainWin = { isDestroyed: () => false, webContents: { send: vi.fn((c: string, d: unknown) => sentToMain.push({ channel: c, data: d })) } }

const ARGS = { appId: 'a', projectDir: '/p', host: 'a.proj', entry: 'background.html', storage: false, media: [] as string[] }

describe('WorkerHost lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sentToShell.length = 0
    sentToMain.length = 0
    wh.initWorkerHost(() => mainWin as never)
  })
  afterEach(() => {
    wh.stopAllWorkers()
    vi.useRealTimers()
  })

  it('starts once and reports running status', () => {
    const s1 = wh.startWorker(ARGS)
    expect(s1.running).toBe(true)
    const s2 = wh.startWorker(ARGS)
    expect(s2.since).toBe(s1.since)
    expect(wh.workerStatus('/p', 'a').running).toBe(true)
    expect(wh.hasActiveWorkers()).toBe(true)
  })

  it('buffers fg->worker until ready, then flushes', () => {
    wh.startWorker(ARGS)
    wh.sendToWorker('/p', 'a', { cmd: 1 })
    expect(sentToShell.filter((m) => m.channel.includes('worker'))).toHaveLength(0)
    wh.handleWorkerSend('/p', 'a', 'miniapp-ready', {})
    const evt = sentToShell.find((m) => (m.data as { payload?: unknown }).payload)
    expect((evt?.data as { payload: unknown }).payload).toEqual({ cmd: 1 })
  })

  it('relays worker->fg event to the main window', () => {
    wh.startWorker(ARGS)
    wh.handleWorkerSend('/p', 'a', 'miniapp-worker-event', { payload: { hi: true } })
    const relayed = sentToMain.find((m) => (m.data as { payload?: unknown }).payload)
    expect((relayed?.data as { appId: string; payload: unknown })).toMatchObject({ appId: 'a', projectDir: '/p', payload: { hi: true } })
  })

  it('keeps alive while a lease is held and reclaims after idle once released', () => {
    wh.startWorker(ARGS)
    wh.handleWorkerSend('/p', 'a', 'miniapp-worker-lease', { leaseId: 1 })
    vi.advanceTimersByTime(60_000)
    expect(wh.workerStatus('/p', 'a').running).toBe(true)
    wh.handleWorkerSend('/p', 'a', 'miniapp-worker-lease-release', { leaseId: 1 })
    vi.advanceTimersByTime(30_001)
    expect(wh.workerStatus('/p', 'a').running).toBe(false)
  })

  it('stopWorker destroys the window', () => {
    wh.startWorker(ARGS)
    wh.stopWorker('/p', 'a')
    expect(wh.workerStatus('/p', 'a').running).toBe(false)
    expect(wh.hasActiveWorkers()).toBe(false)
  })
})
