/** @vitest-environment jsdom */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useChatScroll } from './useChatScroll'

vi.mock('@/stores/chat', () => ({
  useActiveSession: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockSessionState)
  ),
  useSessionScope: vi.fn(() => mockSessionScope),
}))

let mockSessionScope: { projectPath: string; sessionId: string } | null = null
let mockSessionState: Record<string, unknown> = {
  messages: [],
  _activeSessionId: 'session-1',
  status: 'streaming',
}

function createMockViewport() {
  const el = document.createElement('div')
  // `scrollTopWrites` counts *writes*, not position changes: a redundant write
  // that lands on the same offset still fires a `scroll` event and still drags
  // the whole handleScroll / scroll-indicator cascade behind it.
  // `maxScrollTopOverride` models a fractional layout: the browser rounds
  // scrollHeight/clientHeight to integers, but clamps scrollTop against the real
  // (sub-pixel) bottom. Leave it null for the integer-metrics default.
  const state = {
    scrollTop: 0,
    scrollHeight: 500,
    clientHeight: 300,
    scrollTopWrites: 0,
    maxScrollTopOverride: null as number | null,
  }
  const contentChild = document.createElement('div')
  el.appendChild(contentChild)
  Object.defineProperty(el, 'scrollHeight', {
    get: () => state.scrollHeight,
    configurable: true,
  })
  Object.defineProperty(el, 'scrollTop', {
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTopWrites++
      state.scrollTop = Math.min(v, state.maxScrollTopOverride ?? (state.scrollHeight - state.clientHeight))
    },
    configurable: true,
  })
  Object.defineProperty(el, 'clientHeight', {
    get: () => state.clientHeight,
    configurable: true,
  })
  el.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (top != null) state.scrollTop = Math.min(top, state.scrollHeight - state.clientHeight)
  }) as unknown as typeof el.scrollTo
  return { el, state, contentChild }
}

function wheelUp(el: HTMLElement, deltaY = -50) {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY }))
}

function touchDrag(el: HTMLElement, fromY: number, toY: number) {
  const start = new Event('touchstart')
  Object.defineProperty(start, 'touches', { value: [{ clientY: fromY }] })
  el.dispatchEvent(start)
  const move = new Event('touchmove')
  Object.defineProperty(move, 'touches', { value: [{ clientY: toY }] })
  el.dispatchEvent(move)
}

let resizeSubscriptions: Array<{ target: Element; cb: ResizeObserverCallback }> = []

class MockResizeObserver {
  _cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this._cb = cb
  }
  observe(target: Element) { resizeSubscriptions.push({ target, cb: this._cb }) }
  disconnect() { resizeSubscriptions = resizeSubscriptions.filter((sub) => sub.cb !== this._cb) }
  unobserve(target: Element) {
    resizeSubscriptions = resizeSubscriptions.filter((sub) => !(sub.cb === this._cb && sub.target === target))
  }
}

describe('useChatScroll', () => {
  beforeEach(() => {
    resizeSubscriptions = []
    mockSessionScope = null
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    mockSessionState = {
      messages: [{ id: '1', role: 'assistant', content: [] }],
      _activeSessionId: 'session-1',
      status: 'streaming',
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function fireResize(target?: Element) {
    const matched = resizeSubscriptions.filter((sub) => !target || sub.target === target)
    const callbacks = [...new Set(matched.map((sub) => sub.cb))]
    for (const cb of callbacks) {
      const entries = matched
        .filter((sub) => sub.cb === cb)
        .map((sub) => ({ target: sub.target } as ResizeObserverEntry))
      cb(entries, {} as ResizeObserver)
    }
  }

  it('scrolls to bottom on ResizeObserver callback when following', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(500)
  })

  it('scrolls to bottom when viewport height changes during streaming', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.clientHeight = 250
    fireResize(el)
    expect(state.scrollTop).toBe(250)
  })

  it('stops following on wheel-up before any scroll event fires', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { wheelUp(el, -1) })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(200)
  })

  it('does not scroll on resize after user wheels up to the top', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      wheelUp(el)
      state.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(0)
  })

  it('stops following on a slight wheel-up during streaming (still outside the bottom band)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }
    state.scrollTop = state.scrollHeight - state.clientHeight

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      wheelUp(el, -30)
      state.scrollTop = state.scrollHeight - state.clientHeight - 30
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(170)
  })

  it('keeps a slight wheel-up paused even when it remains inside the bottom band', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }
    state.scrollTop = state.scrollHeight - state.clientHeight

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      wheelUp(el, -10)
      state.scrollTop -= 10
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(190)
  })

  it('stops following on touch drag downward (content scrolling up)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { touchDrag(el, 100, 180) })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(200)
  })

  it('stops following on PageUp key', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' })) })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(200)
  })

  it('disables auto-scroll when stopAutoScroll is called (e.g. scroll-indicator tick jump)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { result } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { result.current.stopAutoScroll() })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(200)
    expect(result.current.showScrollButton).toBe(true)
  })

  it('resumes following when a tick jump lands at the bottom (stopAutoScroll then reach bottom)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { result } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { result.current.stopAutoScroll() })

    act(() => {
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(500)
  })

  it('stays stopped when a tick jump scrolls upward (stopAutoScroll then land mid)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { result } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => { result.current.stopAutoScroll() })

    act(() => {
      state.scrollTop = 40
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(40)
  })

  it('keeps following across programmatic and clamp scroll events (content expansion)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      state.scrollHeight = 1000
      el.dispatchEvent(new Event('scroll'))
    })

    act(() => { fireResize() })
    expect(state.scrollTop).toBe(700)
  })

  it('keeps following when content shrinks and clamps scrollTop while pinned to bottom', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      state.scrollHeight = 450
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 900
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(600)
  })

  it('does not auto-scroll messages while user is scrolled up during streaming', () => {
    vi.useFakeTimers()
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))
    act(() => { fireResize() })
    vi.advanceTimersByTime(500)

    const scrolledPos = 0
    act(() => {
      wheelUp(el)
      state.scrollTop = scrolledPos
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 900
    mockSessionState = {
      ...mockSessionState,
      messages: [
        { id: '1', role: 'assistant', content: [{ type: 'text', text: 'updated' }] },
      ],
    }
    rerender()
    expect(state.scrollTop).toBe(scrolledPos)
    vi.useRealTimers()
  })

  it('preserves wheel-up intent while session-switch layout is still settling', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }
    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      wheelUp(el)
      state.scrollTop = 100
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    mockSessionState = {
      ...mockSessionState,
      messages: [{ id: '1', role: 'assistant', content: [{ type: 'text', text: 'updated' }] }],
    }
    rerender()

    expect(state.scrollTop).toBe(100)
  })

  it('rebinds scrolling when a scoped pane changes sessions', () => {
    mockSessionScope = { projectPath: '/project', sessionId: 'scoped-1' }
    const first = createMockViewport()
    const ref = { current: first.el }
    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    const second = createMockViewport()
    second.state.scrollTop = 0
    ref.current = second.el
    mockSessionScope = { projectPath: '/project', sessionId: 'scoped-2' }
    rerender()

    expect(second.state.scrollTop).toBe(200)
    second.state.scrollHeight = 800
    act(() => { fireResize(second.contentChild) })
    expect(second.state.scrollTop).toBe(500)
  })

  it('resumes following when user scrolls back to the bottom', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      wheelUp(el)
      state.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(500)
  })

  it('does not scroll on resize when not streaming', () => {
    vi.useFakeTimers()
    mockSessionState = { ...mockSessionState, status: 'idle' }
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))
    act(() => { fireResize() })
    vi.advanceTimersByTime(500)

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(200)
    vi.useRealTimers()
  })

  it('scrolls to bottom when messages change and following', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.scrollHeight = 800
    mockSessionState = {
      ...mockSessionState,
      messages: [
        { id: '1', role: 'assistant', status: 'streaming', content: [] },
        { id: '2', role: 'assistant', status: 'streaming', content: [] },
      ],
    }
    rerender()
    expect(state.scrollTop).toBe(500)
  })

  it('scrolls to bottom when the last streaming message content updates and following', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.scrollHeight = 900
    mockSessionState = {
      ...mockSessionState,
      messages: [
        { id: '1', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'updated' }] },
      ],
    }
    rerender()
    expect(state.scrollTop).toBe(600)
  })

  it('skips the redundant scrollTop write when a resize lands on an already-pinned viewport', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    // One streaming frame: content grows and `messages` churns, so the layout
    // effect pins to the bottom.
    state.scrollHeight = 800
    mockSessionState = {
      ...mockSessionState,
      messages: [{ id: '1', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'updated' }] }],
    }
    rerender()
    expect(state.scrollTop).toBe(500)

    const writesAfterMessagePin = state.scrollTopWrites

    // Same frame: the ResizeObserver fires for the very same height change. We
    // are already at the bottom, so this must not write again — every extra
    // write costs another scroll-event cascade (handleScroll + indicator rAF +
    // getBoundingClientRect), which is O(messages) of forced layout.
    act(() => { fireResize() })

    expect(state.scrollTop).toBe(500)
    expect(state.scrollTopWrites).toBe(writesAfterMessagePin)
  })

  it('treats a sub-pixel gap as already pinned so fractional layouts keep the dedup', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    // Fractional layout — routine here because responsive chat sizing and a
    // non-integer DPR both produce sub-pixels. Reported metrics round *up* to
    // 801/300 (computed max 501) while the real bottom sits at 500.2. A strict
    // `scrollTop >= scrollHeight - clientHeight` can never hold in this shape,
    // which would silently degrade the dedup back to "write every frame".
    state.scrollHeight = 801
    state.maxScrollTopOverride = 500.2
    mockSessionState = {
      ...mockSessionState,
      messages: [{ id: '1', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'updated' }] }],
    }
    rerender()
    expect(state.scrollTop).toBe(500.2)

    const writesAfterMessagePin = state.scrollTopWrites

    act(() => { fireResize() })

    expect(state.scrollTop).toBe(500.2)
    expect(state.scrollTopWrites).toBe(writesAfterMessagePin)
  })

  it('still pins on resize when content grew after the layout effect ran', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    // Late growth (image decode, font swap) with no `messages` change: the
    // ResizeObserver is the only path that can catch this, so it must write.
    state.scrollHeight = 900
    act(() => { fireResize() })

    expect(state.scrollTop).toBe(600)
  })

  it('scrolls to bottom after plan approval dismissal via ResizeObserver', () => {
    vi.useFakeTimers()
    mockSessionState = {
      ...mockSessionState,
      status: 'idle',
      pendingPlanApproval: { requestId: 'plan-1', planContent: 'test', planFilePath: '', allowedPrompts: [] },
    }
    const { el, state } = createMockViewport()
    const ref = { current: el }
    state.scrollTop = 0

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))
    act(() => { fireResize() })
    vi.advanceTimersByTime(500)

    mockSessionState = { ...mockSessionState, pendingPlanApproval: null }
    rerender()

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(500)
    vi.useRealTimers()
  })

  it('scrolls to bottom immediately when ResizeObserver effect re-runs after plan dismissal', () => {
    vi.useFakeTimers()
    mockSessionState = {
      ...mockSessionState,
      status: 'idle',
      pendingPlanApproval: { requestId: 'plan-1', planContent: 'test', planFilePath: '', allowedPrompts: [] },
    }
    const ref = { current: null as HTMLDivElement | null }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))
    vi.advanceTimersByTime(500)

    const { el, state } = createMockViewport()
    ref.current = el
    state.scrollTop = 0
    state.scrollHeight = 800

    mockSessionState = { ...mockSessionState, pendingPlanApproval: null }
    rerender()
    vi.advanceTimersByTime(0)

    expect(state.scrollTop).toBe(500)
    vi.useRealTimers()
  })
})
