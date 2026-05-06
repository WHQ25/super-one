import { beforeEach, describe, expect, it, vi } from 'vitest'

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_out_capturing: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: posthogMock }))

vi.stubGlobal('__POSTHOG_PROJECT_TOKEN__', 'test-key')
vi.stubGlobal('__POSTHOG_HOST__', '')
vi.stubGlobal('__APP_VERSION__', '0.0.1')
vi.stubGlobal('window', { app: { platform: 'darwin' } })

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('initAnalytics calls posthog.init with correct config', async () => {
    const { initAnalytics } = await import('./analytics')
    initAnalytics()
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
    initAnalytics()
    initAnalytics()
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
  })

  it('shutdownAnalytics calls opt_out and reset', async () => {
    const { initAnalytics, shutdownAnalytics, isAnalyticsInitialized } = await import('./analytics')
    initAnalytics()
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
})
