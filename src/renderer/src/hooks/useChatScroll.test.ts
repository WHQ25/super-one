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

  it('scrolls to bottom on ResizeObserver callback when near bottom', () => {
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

  it('does not scroll on resize when user has scrolled up', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      el.dispatchEvent(new Event('wheel'))
      state.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(0)
  })

  it('keeps auto-scroll when user scrolls up slightly during streaming (within 200px of bottom)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }
    state.scrollTop = state.scrollHeight - state.clientHeight

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      el.dispatchEvent(new Event('wheel'))
      state.scrollTop = state.scrollHeight - state.clientHeight - 30
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(500)
  })

  it('keeps auto-scroll when programmatic scroll fires after content expansion', () => {
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

  it('disables auto-scroll on user-initiated upward scroll during streaming', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    const { rerender } = renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    const scrolledPos = 50
    act(() => {
      el.dispatchEvent(new Event('wheel'))
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
  })

  it('keeps auto-scroll disabled when ResizeObserver fires between wheel and scroll (trackpad race)', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }
    state.scrollTop = state.scrollHeight - state.clientHeight

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      el.dispatchEvent(new Event('wheel'))
    })

    act(() => {
      state.scrollHeight = 600
      state.scrollTop = state.scrollHeight - state.clientHeight
      el.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      el.dispatchEvent(new Event('wheel'))
      state.scrollTop = 100
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 900
    act(() => { fireResize() })
    expect(state.scrollTop).toBe(100)
  })

  it('re-enables auto-scroll when user scrolls back near bottom', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
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
    mockSessionState = { ...mockSessionState, status: 'idle' }
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(200)
  })

  it('scrolls to bottom when messages change and near bottom', () => {
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
})
