/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'

const { appStateRef } = vi.hoisted(() => ({
  appStateRef: { layoutMode: 'coding' as 'coding' | 'canvas' },
}))

vi.mock('@/stores/app', () => {
  const getState = () => ({ layoutMode: appStateRef.layoutMode })
  const useAppStore = ((selector?: (s: ReturnType<typeof getState>) => unknown) =>
    selector ? selector(getState()) : getState()) as unknown as { getState: typeof getState } & ((selector?: (s: ReturnType<typeof getState>) => unknown) => unknown)
  useAppStore.getState = getState
  return { useAppStore }
})

vi.mock('@/hooks/useSashResizing', () => ({ useSashResizing: () => false }))
vi.mock('@/hooks/useGlobalDragging', () => ({ useGlobalDragging: () => false }))
vi.mock('./browser-automation-runtime', () => ({ useBrowserAutomationHost: () => {} }))
vi.mock('./browser-host-api', () => ({
  registerBrowserWebview: () => () => {},
  browserExecJs: vi.fn().mockResolvedValue(undefined),
  pushBrowserConsole: vi.fn(),
  clearBrowserConsole: vi.fn(),
}))
vi.mock('./browser-annotate-flow', () => ({
  buildSessionScript: () => '',
  handleAnnotationMessage: vi.fn(),
}))
vi.mock('./browser-annotate-script', () => ({
  ANNOTATE_CANCEL_SCRIPT: '',
  ANNOTATE_MSG_PREFIX: '__annotate__',
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

;(globalThis as unknown as { window: typeof window }).window = globalThis as unknown as typeof window
;(globalThis as unknown as { app: Record<string, unknown> }).app = new Proxy(
  {},
  { get: (_t, prop) => (prop === 'onBrowserAnnotateShortcut' || prop === 'onBrowserCertError' ? () => () => {} : () => Promise.resolve()) },
)

let useBrowserStore: typeof import('@/stores/browser').useBrowserStore
let useActivityPanelStore: typeof import('@/stores/activity-panel').useActivityPanelStore
let BrowserHostLayer: typeof import('./BrowserHostLayer').BrowserHostLayer

const RECT = { left: 120, top: 44, width: 560, height: 800 } as DOMRectReadOnly

beforeEach(async () => {
  vi.clearAllMocks()
  appStateRef.layoutMode = 'coding'
  vi.resetModules()
  ;({ useBrowserStore } = await import('@/stores/browser'))
  ;({ useActivityPanelStore } = await import('@/stores/activity-panel'))
  ;({ BrowserHostLayer } = await import('./BrowserHostLayer'))
  act(() => useActivityPanelStore.getState().setShowPanel(true))
})

describe('BrowserHostLayer mosaic visibility', () => {
  it('parks panel-mode browser off-screen but keeps it mounted while the activity panel is collapsed (mosaic keep-alive)', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
    expect(host.style.pointerEvents).toBe('auto')

    act(() => useActivityPanelStore.getState().setShowPanel(false))
    // Resting hidden state: off-screen (not display:none) so a live page keeps
    // running without reload, but cheap — no in-viewport compositing.
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('-99999px')
    expect(host.style.width).toBe('560px')
    expect(host.style.height).toBe('800px')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
    expect(host.style.pointerEvents).toBe('auto')
  })

  it('display:none for a slotless background tab at rest (no compositing cost)', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      // A tab a background session opened: registered in the store, never given a
      // dock slot in the current view.
      useBrowserStore.getState().ensure('browser-bg', 'https://example.com', 'sess-hidden')
    })

    const host = container.querySelector('[data-browser-id="browser-bg"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('none')
  })

  it('pulls a hidden tab into the viewport (opacity-masked) only while a capture is in flight', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-bg', 'https://example.com', 'sess-hidden')
    })

    const host = container.querySelector('[data-browser-id="browser-bg"]') as HTMLElement
    expect(host.style.display).toBe('none')

    // A screenshot forces it into the viewport so capturePage has a surface.
    act(() => useBrowserStore.getState().beginCapture('browser-bg'))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('0px')
    expect(host.style.width).toBe('1280px')
    expect(host.style.height).toBe('800px')
    expect(host.style.opacity).toBe('0')
    expect(host.style.pointerEvents).toBe('none')

    // Capture done — back to the cheap resting state.
    act(() => useBrowserStore.getState().endCapture('browser-bg'))
    expect(host.style.display).toBe('none')
  })

  it('hides panel-mode browser when layoutMode is canvas', () => {
    appStateRef.layoutMode = 'canvas'
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('none')
  })

  it('parks the webview off-screen when the tab has a certificate error so the interstitial shows', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://self-signed.example')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.left).toBe('120px')

    act(() => useBrowserStore.getState().patch('browser-a', { certError: { url: 'https://self-signed.example', error: 'ERR_CERT_AUTHORITY_INVALID' } }))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('-99999px')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useBrowserStore.getState().patch('browser-a', { certError: null }))
    expect(host.style.left).toBe('120px')
  })

  it('keeps a canvas-mode (fullscreen) browser visible regardless of activity panel state', () => {
    appStateRef.layoutMode = 'canvas'
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'canvas', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')

    act(() => useActivityPanelStore.getState().setShowPanel(false))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
  })
})
