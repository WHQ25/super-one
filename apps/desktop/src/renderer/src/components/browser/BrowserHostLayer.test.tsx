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
  // Every `on*` is a subscription that must hand back an unsubscribe, or React
  // throws "destroy is not a function" on cleanup. Matched by shape rather than by
  // name so adding a listener to the component does not silently break every test.
  { get: (_t, prop) => (typeof prop === 'string' && prop.startsWith('on') ? () => () => {} : () => Promise.resolve()) },
)

let useBrowserStore: typeof import('@/stores/browser').useBrowserStore
let useActivityPanelStore: typeof import('@/stores/activity-panel').useActivityPanelStore
let useAgentViewfinderStore: typeof import('@/stores/agent-viewfinder').useAgentViewfinderStore
let useWindowMiniModeStore: typeof import('@/stores/window-mini-mode').useWindowMiniModeStore
let BrowserHostLayer: typeof import('./BrowserHostLayer').BrowserHostLayer

const RECT = { left: 120, top: 44, width: 560, height: 800 } as DOMRectReadOnly

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  ;({ useBrowserStore } = await import('@/stores/browser'))
  ;({ useActivityPanelStore } = await import('@/stores/activity-panel'))
  ;({ useAgentViewfinderStore } = await import('@/stores/agent-viewfinder'))
  ;({ useWindowMiniModeStore } = await import('@/stores/window-mini-mode'))
  ;({ BrowserHostLayer } = await import('./BrowserHostLayer'))
  useAgentViewfinderStore.setState({ activeBySession: {} })
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

  it('parks the browser when the mini-window fold hides the panel behind the user toggle', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.left).toBe('120px')

    // The fold shuts both side panels without touching `showPanel` — the user's own
    // toggle has to survive the round trip. The panel collapses its outer wrapper to
    // width 0 while the inner dockview keeps its layout box, so this slot stays live
    // and non-zero: gate on `showPanel` alone and the webview paints full size over
    // the folded mini chat window.
    act(() => useWindowMiniModeStore.setState({ phase: 'mini', panelsFolded: true }))
    expect(useActivityPanelStore.getState().showPanel).toBe(true)
    expect(host.style.left).toBe('-99999px')
    expect(host.style.pointerEvents).toBe('none')

    act(() => useWindowMiniModeStore.setState({ phase: 'app', panelsFolded: false }))
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

  it('reveals agent-injected about:blank content in picture-in-picture', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-blank', 'about:blank', 'session-a')
      useBrowserStore.getState().updateSlot('browser-blank', 'pip', {
        left: 700,
        top: 80,
        width: 360,
        height: 240,
      } as DOMRectReadOnly)
      useBrowserStore.getState().beginAutomation('browser-blank')
      useBrowserStore.getState().markAutomationPreviewReady('browser-blank')
      useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-blank')
      useActivityPanelStore.getState().setShowPanel(false)
    })

    const host = container.querySelector('[data-browser-id="browser-blank"]') as HTMLElement
    expect(host.style.opacity).toBe('0')

    act(() => useBrowserStore.getState().patch('browser-blank', { hasCustomBlankContent: true }))
    expect(host.style.opacity).toBe('1')
    expect(host.style.backgroundColor).toBe('white')
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
      useBrowserStore.getState().ensure('browser-a', 'https://example.com', 'session-a')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
      useBrowserStore.getState().updateSlot('browser-a', 'pip', {
        left: 700,
        top: 80,
        width: 360,
        height: 240,
      } as DOMRectReadOnly)
      useBrowserStore.getState().beginAutomation('browser-a')
      useBrowserStore.getState().markAutomationPreviewReady('browser-a')
      useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
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

    // Recording keeps the normal PiP presentation for its whole lifetime.
    act(() => useBrowserStore.getState().beginCapture('browser-a'))
    expect(host.style.left).toBe('700px')
    expect(host.style.width).toBe('280px')
    expect(host.style.opacity).toBe('1')
    expect(webview.style.transform).toBe('scale(0.5)')
    act(() => useBrowserStore.getState().endCapture('browser-a'))

    // A still screenshot is short-lived and needs the guest raster at 1:1.
    act(() => useBrowserStore.getState().beginFullResolutionCapture('browser-a'))
    expect(host.style.left).toBe('0px')
    expect(host.style.top).toBe('0px')
    expect(host.style.width).toBe('560px')
    expect(host.style.height).toBe('800px')
    expect(host.style.opacity).toBe('0')
    expect(webview.style.width).toBe('100%')
    expect(webview.style.height).toBe('100%')
    expect(webview.style.transform).toBe('')

    act(() => useBrowserStore.getState().endFullResolutionCapture('browser-a'))
    expect(host.style.left).toBe('700px')
    expect(host.style.top).toBe('80px')
    expect(host.style.width).toBe('280px')
    expect(host.style.opacity).toBe('1')
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

  // RECT's bottom-left and bottom-right both land on this, so a single group
  // filling the panel owns whichever corner the panel's side puts on the card.
  const PANEL_BOUNDS = { left: RECT.left, top: 10, width: RECT.width, height: RECT.top + RECT.height - 10 }

  it('matches the outer bottom corner to the activity panel side', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
      useActivityPanelStore.getState().setBounds(PANEL_BOUNDS)
      useActivityPanelStore.getState().setSide('left')
    })

    const host = container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
    expect(host.style.borderBottomLeftRadius).toBe('var(--radius-xl)')
    expect(host.style.borderBottomRightRadius).toBe('')

    act(() => useActivityPanelStore.getState().setSide('right'))
    expect(host.style.borderBottomLeftRadius).toBe('')
    expect(host.style.borderBottomRightRadius).toBe('var(--radius-xl)')
  })

  it('leaves a group that is not in the corner square, so a sash gets no notch', () => {
    const { container } = render(<BrowserHostLayer />)
    act(() => {
      useBrowserStore.getState().ensure('browser-top', 'https://example.com')
      // Upper half of a vertically split panel: same left edge, bottom stops at
      // the sash rather than at the panel's own bottom.
      useBrowserStore.getState().updateSlot('browser-top', 'panel', {
        ...RECT,
        height: RECT.height / 2,
      } as DOMRectReadOnly)
      useActivityPanelStore.getState().setBounds(PANEL_BOUNDS)
      useActivityPanelStore.getState().setSide('left')
    })

    const host = container.querySelector('[data-browser-id="browser-top"]') as HTMLElement
    expect(host.style.borderBottomLeftRadius).toBe('')

    // The lower half of the same split does own the corner.
    act(() => {
      useBrowserStore.getState().ensure('browser-bottom', 'https://example.org')
      useBrowserStore.getState().updateSlot('browser-bottom', 'panel', {
        ...RECT,
        top: RECT.top + RECT.height / 2,
        height: RECT.height / 2,
      } as DOMRectReadOnly)
    })

    const bottom = container.querySelector('[data-browser-id="browser-bottom"]') as HTMLElement
    expect(bottom.style.borderBottomLeftRadius).toBe('var(--radius-xl)')
  })
})

describe('BrowserHostLayer page canvas', () => {
  const mountLoadedTab = async (probe: unknown) => {
    const { browserExecJs } = await import('./browser-host-api')
    vi.mocked(browserExecJs).mockResolvedValue(probe)
    const { container } = render(<BrowserHostLayer />)
    await act(async () => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com')
      useBrowserStore.getState().updateSlot('browser-a', 'panel', RECT)
    })
    return container.querySelector('[data-browser-id="browser-a"]') as HTMLElement
  }

  // The glass window has no background of its own, so a page that paints none
  // either would show the app's vibrancy instead of a browser canvas.
  it('paints the light canvas behind a page that declares no colour-scheme', async () => {
    const host = await mountLoadedTab(['normal', true])
    expect(host.style.backgroundColor).toBe('white')
  })

  it('paints the dark canvas behind a page whose used colour-scheme is dark', async () => {
    const host = await mountLoadedTab(['light dark', true])
    expect(host.style.backgroundColor).toBe('rgb(18, 18, 18)')
  })

  it('leaves the new-tab page on glass', async () => {
    const host = await mountLoadedTab(['light dark', true])
    await act(async () => useBrowserStore.getState().patch('browser-a', { url: 'about:blank' }))
    expect(host.style.backgroundColor).toBe('')
  })
})
