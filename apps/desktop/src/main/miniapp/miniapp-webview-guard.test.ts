import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({
  session: { fromPartition: vi.fn(() => ({ protocol: {} })) },
  shell: { openExternal: vi.fn() },
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./miniapp-protocol', () => ({ registerMiniAppProtocolHandlers: vi.fn() }))

const { attachMiniAppWebviewGuards, evaluateWebviewAttach, miniAppPreloadPath } = await import('./miniapp-webview-guard')

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
    expect(attach()).toEqual({ kind: 'miniapp', appId: 'demo' })
  })

  it('accepts a non-normalized preload path pointing at the same file', () => {
    expect(attach({ preload: '/app/out/preload/../preload/miniapp-preload.js' }).kind).toBe('miniapp')
  })

  it('rejects a partition belonging to another app', () => {
    expect(attach({ partition: 'persist:miniapp-other' }).kind).toBe('blocked')
  })

  it('rejects a mini-app origin loaded into a shared partition', () => {
    expect(attach({ partition: '' }).kind).toBe('blocked')
    expect(attach({ partition: 'persist:browser' }).kind).toBe('blocked')
  })

  it('rejects a mini-app attach carrying any other preload', () => {
    expect(attach({ preload: '/app/out/preload/index.js' }).kind).toBe('blocked')
    expect(attach({ preload: '' }).kind).toBe('blocked')
  })

  it('rejects a foreign src smuggled into a mini-app partition', () => {
    expect(attach({ src: 'https://evil.example/index.html' }).kind).toBe('blocked')
    expect(attach({ src: 'file:///etc/passwd' }).kind).toBe('blocked')
    expect(attach({ src: 'not a url' }).kind).toBe('blocked')
    expect(attach({ src: '' }).kind).toBe('blocked')
  })

  // The event fires for every <webview> in the window, mini-app or not. Judging a
  // non-mini-app attach by mini-app rules is what took the built-in browser down.
  it('has no opinion on a webview that never claimed to be a mini-app', () => {
    const browser = { partition: 'persist:browser', preload: '', expectedPreload: PRELOAD }
    expect(attach({ ...browser, src: 'http://localhost:6006/' }).kind).toBe('foreign')
    expect(attach({ ...browser, src: 'https://example.com/' }).kind).toBe('foreign')
    expect(attach({ ...browser, src: 'about:blank' }).kind).toBe('foreign')
    expect(attach({ ...browser, src: '' }).kind).toBe('foreign')
  })

  it('still blocks a foreign webview that asks for a preload of its own', () => {
    const decision = attach({
      src: 'https://evil.example/',
      partition: 'persist:browser',
      preload: '/app/out/preload/index.js',
    })
    expect(decision.kind).toBe('blocked')
  })
})

interface FakeAttach {
  webPreferences: Record<string, unknown>
  params: Record<string, unknown>
  prevented: boolean
}

/** Drives the real `will-attach-webview` listener the guard installs. */
function attachWindow() {
  const emitter = new EventEmitter()
  const win = { webContents: emitter } as unknown as BrowserWindow
  attachMiniAppWebviewGuards(win)

  return (params: Record<string, unknown>, webPreferences: Record<string, unknown> = {}): FakeAttach => {
    const state: FakeAttach = { webPreferences, params, prevented: false }
    emitter.emit(
      'will-attach-webview',
      { preventDefault: () => { state.prevented = true } },
      webPreferences,
      params,
    )
    return state
  }
}

describe('mini-app webview guards on a shared window', () => {
  it('lets the built-in browser attach its own webview', () => {
    const result = attachWindow()({ src: 'http://localhost:6006/', partition: 'persist:browser' })
    expect(result.prevented).toBe(false)
  })

  it('hardens a foreign webview without reshaping it into a mini-app', () => {
    const result = attachWindow()({ src: 'https://example.com/', partition: 'persist:browser' }, {})
    expect(result.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    })
    // `sandbox` is a mini-app choice; imposing it here would silently change how
    // the browser's own webview runs.
    expect(result.webPreferences).not.toHaveProperty('sandbox')
  })

  it('still hardens and admits a genuine mini-app webview', () => {
    const result = attachWindow()(
      { src: 'superone-app://demo.proj1/index.html', partition: 'persist:miniapp-demo' },
      { preload: miniAppPreloadPath() },
    )
    expect(result.prevented).toBe(false)
    expect(result.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    })
  })

  it('still blocks a webview impersonating a mini-app', () => {
    const result = attachWindow()(
      { src: 'superone-app://demo.proj1/index.html', partition: 'persist:miniapp-other' },
      { preload: miniAppPreloadPath() },
    )
    expect(result.prevented).toBe(true)
  })
})
