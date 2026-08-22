import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./miniapp-protocol', () => ({ registerMiniAppProtocolHandlers: vi.fn() }))

const { evaluateWebviewAttach } = await import('./miniapp-webview-guard')

const PRELOAD = '/app/out/preload/miniapp-preload.js'

function attach(overrides: Partial<Parameters<typeof evaluateWebviewAttach>[0]> = {}) {
  return evaluateWebviewAttach({
    src: 'superone-app://demo.proj1/index.html',
    partition: 'persist:miniapp-demo',
    preload: PRELOAD,
    expectedPreload: PRELOAD,
    ...overrides,
  })
}

describe('mini-app webview attach policy', () => {
  it('accepts an app loading its own origin, partition, and preload', () => {
    expect(attach()).toEqual({ ok: true, appId: 'demo' })
  })

  it('accepts a non-normalized preload path pointing at the same file', () => {
    expect(attach({ preload: '/app/out/preload/../preload/miniapp-preload.js' }).ok).toBe(true)
  })

  it('rejects a partition belonging to another app', () => {
    expect(attach({ partition: 'persist:miniapp-other' }).ok).toBe(false)
  })

  it('rejects a shared or missing partition', () => {
    expect(attach({ partition: '' }).ok).toBe(false)
    expect(attach({ partition: 'persist:browser' }).ok).toBe(false)
  })

  it('rejects any preload other than the mini-app preload', () => {
    expect(attach({ preload: '/app/out/preload/index.js' }).ok).toBe(false)
    expect(attach({ preload: '' }).ok).toBe(false)
  })

  it('rejects a src outside superone-app://', () => {
    expect(attach({ src: 'https://evil.example/index.html' }).ok).toBe(false)
    expect(attach({ src: 'file:///etc/passwd' }).ok).toBe(false)
    expect(attach({ src: 'not a url' }).ok).toBe(false)
    expect(attach({ src: '' }).ok).toBe(false)
  })
})
