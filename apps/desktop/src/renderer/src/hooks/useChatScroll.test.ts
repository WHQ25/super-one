/** @vitest-environment jsdom */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useChatScroll } from './useChatScroll'

vi.mock('@/stores/chat', () => ({
  useActiveSession: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockSessionState)
  ),
}))

let mockSessionState: Record<string, unknown> = {
  messages: [],
  _activeSessionId: 'session-1',
  status: 'streaming',
}

function createMockViewport() {
  const el = document.createElement('div')
  const state = { scrollTop: 0, scrollHeight: 500, clientHeight: 300 }
  const contentChild = document.createElement('div')
  el.appendChild(contentChild)
  Object.defineProperty(el, 'scrollHeight', {
    get: () => state.scrollHeight,
    configurable: true,
  })
  Object.defineProperty(el, 'scrollTop', {
    get: () => state.scrollTop,
    set: (v: number) => { state.scrollTop = Math.min(v, state.scrollHeight - state.clientHeight) },
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
