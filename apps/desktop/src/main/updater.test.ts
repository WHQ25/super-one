import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let downgradeDuringCheck: boolean | undefined

const autoUpdater = {
  channel: '',
  allowDowngrade: false,
  autoDownload: true,
  autoInstallOnAppQuit: false,
  forceDevUpdateConfig: false,
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => {
    downgradeDuringCheck = autoUpdater.allowDowngrade
    return Promise.resolve(null)
  }),
  downloadUpdate: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn(),
}

vi.mock('electron-updater', () => ({ default: { autoUpdater } }))
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

vi.mock('./harness/service', () => ({
  prefetchEnabledHarnessesForAppUpdate: vi.fn(async () => ({ prepared: [], failed: [] })),
}))

const {
  setUpdateChannel,
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  retryUpdateHarnessPrefetch,
  getUpdateMenuState,
  getUpdaterState,
} = await import('./updater')

const { prefetchEnabledHarnessesForAppUpdate } = await import('./harness/service')

describe('update check scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdater.checkForUpdates.mockClear()
    autoUpdater.downloadUpdate.mockClear()
    autoUpdater.quitAndInstall.mockClear()
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    vi.mocked(prefetchEnabledHarnessesForAppUpdate).mockClear()
    vi.mocked(prefetchEnabledHarnessesForAppUpdate).mockResolvedValue({
      prepared: [],
      failed: [],
    })
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

  it('disables autoDownload so the user must start the fetch', () => {
    initUpdater({ isDestroyed: () => true } as never)
    expect(autoUpdater.autoDownload).toBe(false)
  })

  it('keeps autoInstallOnAppQuit off until harness pre-fetch succeeds', () => {
    initUpdater({ isDestroyed: () => true } as never)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('still checks on demand when the user asks manually', () => {
    initUpdater({ isDestroyed: () => true } as never)
    checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('starts the download only when downloadUpdate is called', () => {
    initUpdater({ isDestroyed: () => true } as never)
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    downloadUpdate()
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
  })
})

describe('atomic app + harness package', () => {
  beforeEach(() => {
    autoUpdater.on.mockClear()
    autoUpdater.quitAndInstall.mockClear()
    autoUpdater.downloadUpdate.mockClear()
    autoUpdater.autoInstallOnAppQuit = false
    vi.mocked(prefetchEnabledHarnessesForAppUpdate).mockReset()
    vi.mocked(prefetchEnabledHarnessesForAppUpdate).mockResolvedValue({
      prepared: [],
      failed: [],
    })
    initUpdater({ isDestroyed: () => true } as never)
  })

  function handler(event: string): ((info: { version: string }) => void) | undefined {
    return autoUpdater.on.mock.calls.find(([name]: [string]) => name === event)?.[1] as
      | ((info: { version: string }) => void)
      | undefined
  }

  it('does not mark ready until harness pre-fetch succeeds', async () => {
    const downloaded = handler('update-downloaded')
    expect(downloaded).toBeTypeOf('function')
    downloaded!({ version: '1.2.3' })
    await vi.waitFor(() => {
      expect(prefetchEnabledHarnessesForAppUpdate).toHaveBeenCalledWith(
        '1.2.3',
        expect.any(Function),
      )
    })
    await vi.waitFor(() => {
      expect(getUpdaterState()).toBe('downloaded')
    })
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    installUpdate()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('blocks Restart and exposes harness-error when pre-fetch fails', async () => {
    vi.mocked(prefetchEnabledHarnessesForAppUpdate).mockResolvedValue({
      prepared: [],
      failed: [{ id: 'claude', error: 'network down' }],
    })
    handler('update-downloaded')!({ version: '1.2.4' })
    await vi.waitFor(() => {
      expect(getUpdaterState()).toBe('harness-error')
    })
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    installUpdate()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(getUpdateMenuState()).toEqual({
      label: 'Retry Harness Download',
      enabled: true,
    })
  })

  it('retries harness pre-fetch without re-downloading the app', async () => {
    vi.mocked(prefetchEnabledHarnessesForAppUpdate)
      .mockResolvedValueOnce({
        prepared: [],
        failed: [{ id: 'claude', error: 'boom' }],
      })
      .mockResolvedValueOnce({ prepared: [{ id: 'claude', runtimeVersion: '1', reused: false }], failed: [] })

    handler('update-downloaded')!({ version: '2.0.0' })
    await vi.waitFor(() => expect(getUpdaterState()).toBe('harness-error'))

    retryUpdateHarnessPrefetch()
    await vi.waitFor(() => expect(getUpdaterState()).toBe('downloaded'))
    expect(prefetchEnabledHarnessesForAppUpdate).toHaveBeenCalledTimes(2)
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
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

describe('update-available menu state', () => {
  beforeEach(() => {
    autoUpdater.on.mockClear()
    initUpdater({ isDestroyed: () => true } as never)
  })

  it('offers Download Update when an update is available', () => {
    const availableHandler = autoUpdater.on.mock.calls.find(
      ([event]: [string]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    expect(availableHandler).toBeTypeOf('function')
    availableHandler!({ version: '1.2.3' })
    expect(getUpdaterState()).toBe('available')
    expect(getUpdateMenuState()).toEqual({ label: 'Download Update', enabled: true })
  })
})
