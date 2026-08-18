/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'

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
  ANNOTATE_CTX_TRACKER_SCRIPT: '',
  ANNOTATE_MSG_PREFIX: '__annotate__',
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

;(globalThis as unknown as { window: typeof window }).window = globalThis as unknown as typeof window
;(globalThis as unknown as { app: Record<string, unknown> }).app = new Proxy(
  {},
  { get: (_t, prop) => (prop === 'onBrowserAnnotateShortcut' || prop === 'onBrowserCertError' || prop === 'onBrowserOpenTab' ? () => () => {} : () => Promise.resolve()) },
)

let useBrowserStore: typeof import('@/stores/browser').useBrowserStore
let useActivityPanelStore: typeof import('@/stores/activity-panel').useActivityPanelStore
let BrowserHostLayer: typeof import('./BrowserHostLayer').BrowserHostLayer

const RECT = { left: 120, top: 44, width: 560, height: 800 } as DOMRectReadOnly

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  ;({ useBrowserStore } = await import('@/stores/browser'))
  ;({ useActivityPanelStore } = await import('@/stores/activity-panel'))
  ;({ BrowserHostLayer } = await import('./BrowserHostLayer'))
  act(() => useActivityPanelStore.getState().setShowPanel(true))
})

describe('BrowserHostLayer mosaic visibility', () => {
  it('parks the browser while collapsed and reveals it from the activity edge without fading', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
    expect(host.style.clipPath).toBe('inset(0 0 0 0)')
    expect(host.style.pointerEvents).toBe('auto')

    act(() => useActivityPanelStore.getState().setShowPanel(false))
    // Resting hidden state: off-screen (not display:none) so a live page keeps
    // running without reload, but cheap — no in-viewport compositing.
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('-99999px')
    expect(host.style.width).toBe('560px')
    expect(host.style.height).toBe('800px')
    expect(host.style.clipPath).toBe('inset(0 100% 0 0)')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(host.style.display).toBe('block')
    expect(host.style.left).toBe('120px')
    expect(host.style.opacity).toBe('1')
    expect(host.style.clipPath).toBe('inset(0 0 0 0)')
    expect(host.style.transition).toBe('clip-path 300ms cubic-bezier(0.4, 0, 0.2, 1)')
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

  it('reveals a right-docked browser from the right activity edge', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
      useActivityPanelStore.getState().setSide('right')
      useActivityPanelStore.getState().setShowPanel(false)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.clipPath).toBe('inset(0 0 0 100%)')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(host.style.clipPath).toBe('inset(0 0 0 0)')
  })

  it('moves an automated browser between picture-in-picture and the activity panel', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
      useBrowserStore.getState().updateSlot('browser-a', 'pip', {
        left: 700,
        top: 80,
        width: 360,
        height: 240,
      } as DOMRectReadOnly)
      useBrowserStore.getState().beginAutomation('browser-a')
      useBrowserStore.getState().markAutomationPreviewReady('browser-a')
      useActivityPanelStore.getState().setShowPanel(false)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    const webview = host.querySelector('webview') as HTMLElement
    expect(host.dataset.browserPresentation).toBe('pip')
    expect(host.style.left).toBe('700px')
    expect(host.style.top).toBe('80px')
    expect(host.style.width).toBe('360px')
    expect(host.style.pointerEvents).toBe('none')
    expect(host.style.borderTopLeftRadius).toBe('var(--radius-xl)')
    expect(host.style.borderTopRightRadius).toBe('var(--radius-xl)')
    expect(host.style.borderBottomLeftRadius).toBe('var(--radius-xl)')
    expect(host.style.borderBottomRightRadius).toBe('var(--radius-xl)')
    expect(webview.style.width).toBe('560px')
    expect(webview.style.height).toBe('800px')
    expect(webview.style.transform).toBe('scale(0.6428571428571429)')
    expect(webview.style.transformOrigin).toBe('left top')

    act(() => {
      useBrowserStore.getState().updateSlot('browser-a', 'pip', {
        left: 700,
        top: 80,
        width: 280,
        height: 240,
      } as DOMRectReadOnly)
    })
    expect(webview.style.width).toBe('560px')
    expect(webview.style.height).toBe('800px')
    expect(webview.style.transform).toBe('scale(0.5)')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(host.dataset.browserPresentation).toBe('panel')
    expect(host.style.left).toBe('120px')
    expect(host.style.top).toBe('44px')
    expect(host.style.width).toBe('560px')
    expect(webview.style.width).toBe('100%')
    expect(webview.style.height).toBe('100%')
    expect(webview.style.transform).toBe('')
  })

  it('only enables webview interaction in the expanded overlay', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'overlay', {
        left: 80,
        top: 60,
        width: 1200,
        height: 760,
      } as DOMRectReadOnly)
      useBrowserStore.getState().expandPreview('browser-a')
      useActivityPanelStore.getState().setShowPanel(false)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.dataset.browserPresentation).toBe('overlay')
    expect(host.style.left).toBe('80px')
    expect(host.style.pointerEvents).toBe('auto')
    expect(host.style.borderTopLeftRadius).toBe('')
    expect(host.style.borderTopRightRadius).toBe('')
    expect(host.style.borderBottomLeftRadius).toBe('')
    expect(host.style.borderBottomRightRadius).toBe('')
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
    expect(host.style.clipPath).toBe('inset(0 0 0 0)')
    expect(host.style.transition).toBe('none')
    expect(host.style.pointerEvents).toBe('none')

    // Capture done — back to the cheap resting state.
    act(() => useBrowserStore.getState().endCapture('browser-bg'))
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

  it('matches the outer bottom corner to the activity panel side', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
      useActivityPanelStore.getState().setSide('left')
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.borderBottomLeftRadius).toBe('var(--radius-xl)')
    expect(host.style.borderBottomRightRadius).toBe('')

    act(() => useActivityPanelStore.getState().setSide('right'))
    expect(host.style.borderBottomLeftRadius).toBe('')
    expect(host.style.borderBottomRightRadius).toBe('var(--radius-xl)')
  })
})
