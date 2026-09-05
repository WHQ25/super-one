import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_out_capturing: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: posthogMock }))

vi.stubGlobal('__POSTHOG_PROJECT_TOKEN__', 'test-key')
vi.stubGlobal('__POSTHOG_HOST__', '')
vi.stubGlobal('__APP_VERSION__', '0.0.1')

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

let focused = true
let visibility = 'visible'

vi.stubGlobal('window', {
  app: { platform: 'darwin', getInstallId: vi.fn(async () => 'install-abc') },
  localStorage: localStorageStub,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})
vi.stubGlobal('document', {
  get visibilityState() {
    return visibility
  },
  hasFocus: () => focused,
})

/** Drives posthog's `loaded` callback, which is what starts usage tracking. */
function fireLoaded() {
  const config = posthogMock.init.mock.calls[0][1]
  config.loaded(posthogMock)
}

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    store.clear()
    focused = true
    visibility = 'visible'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initAnalytics calls posthog.init with correct config', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    expect(posthogMock.init).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        persistence: 'localStorage',
      }),
    )
  })

  it('initAnalytics is idempotent', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    await initAnalytics()
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
  })

  it('shutdownAnalytics calls opt_out and reset', async () => {
    const { initAnalytics, shutdownAnalytics, isAnalyticsInitialized } = await import('./analytics')
    await initAnalytics()
    shutdownAnalytics()
    expect(posthogMock.opt_out_capturing).toHaveBeenCalled()
    expect(posthogMock.reset).toHaveBeenCalled()
    expect(isAnalyticsInitialized()).toBe(false)
  })

  it('shutdownAnalytics is safe when not initialized', async () => {
    const { shutdownAnalytics } = await import('./analytics')
    shutdownAnalytics()
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('trackEvent does nothing when not initialized', async () => {
    const { trackEvent } = await import('./analytics')
    trackEvent('test_event', { foo: 'bar' })
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('identifyUser does nothing when not initialized', async () => {
    const { identifyUser } = await import('./analytics')
    identifyUser('user-123')
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })

  it('startAnalytics identifies with the persistent install id', async () => {
    const { startAnalytics } = await import('./analytics')
    await startAnalytics()
    fireLoaded()
    expect(posthogMock.identify).toHaveBeenCalledWith('install-abc')
  })

  it('startAnalytics still initializes when the install id is unavailable', async () => {
    const getInstallId = window.app.getInstallId as ReturnType<typeof vi.fn>
    getInstallId.mockRejectedValueOnce(new Error('nope'))
    const { startAnalytics, isAnalyticsInitialized } = await import('./analytics')
    await startAnalytics()
    fireLoaded()
    expect(isAnalyticsInitialized()).toBe(true)
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })

  it('app_opened mirrors version and platform onto person properties', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    expect(posthogMock.capture).toHaveBeenCalledWith('app_opened', {
      app_version: '0.0.1',
      platform: 'darwin',
      $set: { app_version: '0.0.1', platform: 'darwin' },
    })
  })

  it('autocaptures renderer exceptions and registers version and platform as super properties', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    expect(posthogMock.init.mock.calls[0][1]).toMatchObject({ capture_exceptions: true })
    expect(posthogMock.register).toHaveBeenCalledWith({ app_version: '0.0.1', platform: 'darwin' })
  })

  it('reports app_updated once when the version changed since the last run', async () => {
    store.set('superone.analytics.last_version', '0.0.0')
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    expect(posthogMock.capture).toHaveBeenCalledWith('app_updated', {
      from_version: '0.0.0',
      app_version: '0.0.1',
      platform: 'darwin',
    })
    expect(store.get('superone.analytics.last_version')).toBe('0.0.1')
  })

  it('does not report app_updated on a first run or when the version is unchanged', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    expect(posthogMock.capture).not.toHaveBeenCalledWith('app_updated', expect.anything())
    expect(store.get('superone.analytics.last_version')).toBe('0.0.1')

    vi.resetModules()
    posthogMock.capture.mockClear()
    const again = await import('./analytics')
    await again.initAnalytics()
    fireLoaded()
    expect(posthogMock.capture).not.toHaveBeenCalledWith('app_updated', expect.anything())
  })

  it('flushes accumulated active time as one app_usage event per hour', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    posthogMock.capture.mockClear()

    vi.advanceTimersByTime(60 * 60_000)

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    expect(posthogMock.capture).toHaveBeenCalledWith(
      'app_usage',
      expect.objectContaining({ active_seconds: 3600, recovered: false, app_version: '0.0.1' }),
    )
  })

  it('does not count time while the window is unfocused', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    posthogMock.capture.mockClear()

    focused = false
    vi.advanceTimersByTime(30 * 60_000)
    focused = true
    vi.advanceTimersByTime(30 * 60_000)

    expect(posthogMock.capture).toHaveBeenCalledWith(
      'app_usage',
      expect.objectContaining({ active_seconds: 1800 }),
    )
  })

  it('drops a flush window shorter than a minute instead of sending an event', async () => {
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    posthogMock.capture.mockClear()

    focused = false
    vi.advanceTimersByTime(60 * 60_000 - TICK)
    focused = true
    vi.advanceTimersByTime(TICK) // one 15s tick only

    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('recovers unflushed time left behind by a crashed run', async () => {
    store.set('superone.analytics.active_ms', String(25 * 60_000))
    const { initAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()

    expect(posthogMock.capture).toHaveBeenCalledWith(
      'app_usage',
      expect.objectContaining({ active_seconds: 1500, recovered: true }),
    )
    expect(store.has('superone.analytics.active_ms')).toBe(false)
  })

  it('stops accumulating and discards pending time after opt-out', async () => {
    const { initAnalytics, shutdownAnalytics } = await import('./analytics')
    await initAnalytics()
    fireLoaded()
    vi.advanceTimersByTime(30 * 60_000)

    shutdownAnalytics()
    posthogMock.capture.mockClear()
    vi.advanceTimersByTime(2 * 60 * 60_000)

    expect(posthogMock.capture).not.toHaveBeenCalled()
    expect(store.has('superone.analytics.active_ms')).toBe(false)
  })
})

const TICK = 15_000
