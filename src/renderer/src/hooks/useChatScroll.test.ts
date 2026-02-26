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

let resizeCallbacks: Array<() => void> = []

class MockResizeObserver {
  _cb: () => void
  constructor(cb: ResizeObserverCallback) {
    const self = this
    this._cb = () => cb([], self as unknown as ResizeObserver)
  }
  observe() { resizeCallbacks.push(this._cb) }
  disconnect() { resizeCallbacks = resizeCallbacks.filter((fn) => fn !== this._cb) }
  unobserve() {}
}

describe('useChatScroll', () => {
  beforeEach(() => {
    resizeCallbacks = []
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    mockSessionState = {
      messages: [{ id: '1', role: 'assistant', status: 'streaming', content: [] }],
      _activeSessionId: 'session-1',
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function fireResize() {
    resizeCallbacks.forEach((cb) => cb())
  }

  it('scrolls to bottom on ResizeObserver callback when near bottom', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(500)
  })

  it('does not scroll on resize when user has scrolled up', () => {
    const { el, state } = createMockViewport()
    const ref = { current: el }

    renderHook(() => useChatScroll({ scrollViewportRef: ref }))

    act(() => {
      state.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })

    state.scrollHeight = 800
    fireResize()
    expect(state.scrollTop).toBe(0)
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
