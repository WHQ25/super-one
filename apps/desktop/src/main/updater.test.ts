import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let downgradeDuringCheck: boolean | undefined

const autoUpdater = {
  channel: '',
  allowDowngrade: false,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  forceDevUpdateConfig: false,
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => {
    downgradeDuringCheck = autoUpdater.allowDowngrade
    return Promise.resolve(null)
  }),
}

vi.mock('electron-updater', () => ({ default: { autoUpdater } }))
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { setUpdateChannel, initUpdater, checkForUpdates } = await import('./updater')

describe('update check scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdater.checkForUpdates.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks once on startup and never again on a timer', () => {
    initUpdater({ isDestroyed: () => true } as never)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('still checks on demand when the user asks manually', () => {
    initUpdater({ isDestroyed: () => true } as never)
    checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('manual update channel switching', () => {
  beforeEach(() => {
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    downgradeDuringCheck = undefined
    autoUpdater.checkForUpdates.mockClear()
  })

  it('maps the user channel to its electron-builder yml track', () => {
    setUpdateChannel('stable')
    expect(autoUpdater.channel).toBe('latest')
    setUpdateChannel('beta')
    expect(autoUpdater.channel).toBe('beta')
    setUpdateChannel('alpha')
    expect(autoUpdater.channel).toBe('alpha')
  })

  it('allows downgrade during the switch check then resets it afterwards', async () => {
    setUpdateChannel('stable')
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(downgradeDuringCheck).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(autoUpdater.allowDowngrade).toBe(false)
  })
})
