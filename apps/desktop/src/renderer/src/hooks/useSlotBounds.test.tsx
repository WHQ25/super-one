/** @vitest-environment jsdom */

import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSlotBounds } from './useSlotBounds'

let bounds = { left: 10, top: 20, width: 300, height: 200 }
let nextFrameId = 1
let frames = new Map<number, FrameRequestCallback>()
let resizeCallback: ResizeObserverCallback | null = null

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }

  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

function rect(): DOMRect {
  return {
    ...bounds,
    x: bounds.left,
    y: bounds.top,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    toJSON: () => ({}),
  } as DOMRect
}

function flushFrames(limit = 20): void {
  let count = 0
  while (frames.size > 0) {
    if (count++ >= limit)
      throw new Error('slot bounds tracker did not become idle')
    const pending = [...frames.entries()]
    frames = new Map()
    for (const [, callback] of pending) callback(performance.now())
  }
}

function dispatchTransition(
  type: 'transitionstart' | 'transitionend',
  propertyName: string,
): void {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  document.body.dispatchEvent(event)
}

function Fixture({
  trackingKey,
  onBounds,
  onUnregister,
}: {
  trackingKey: string
  onBounds: (next: DOMRectReadOnly) => void
  onUnregister: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSlotBounds(ref, trackingKey, onBounds, onUnregister)
  return <div ref={ref} />
}

describe('useSlotBounds', () => {
  beforeEach(() => {
    bounds = { left: 10, top: 20, width: 300, height: 200 }
    nextFrameId = 1
    frames = new Map()
    resizeCallback = null
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++
        frames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        frames.delete(id)
      }),
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      rect,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stops scheduling frames after bounds stabilize and resumes on resize', () => {
    const onBounds = vi.fn()
    const onUnregister = vi.fn()
    render(
      <Fixture
        trackingKey="slot-1"
        onBounds={onBounds}
        onUnregister={onUnregister}
      />,
    )

    act(flushFrames)

    expect(onBounds).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)

    bounds = { ...bounds, left: 42 }
    act(() => resizeCallback?.([], {} as ResizeObserver))
    act(flushFrames)

    expect(onBounds).toHaveBeenCalledTimes(2)
    expect(onBounds.mock.calls[1][0].left).toBe(42)
    expect(frames.size).toBe(0)
  })

  it('unregisters and cancels a pending frame on cleanup', () => {
    const onUnregister = vi.fn()
    const view = render(
      <Fixture
        trackingKey="slot-1"
        onBounds={vi.fn()}
        onUnregister={onUnregister}
      />,
    )

    expect(frames.size).toBe(1)
    view.unmount()

    expect(onUnregister).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })

  it('tracks geometry for the lifetime of a CSS transition', () => {
    render(
      <Fixture
        trackingKey="slot-1"
        onBounds={vi.fn()}
        onUnregister={vi.fn()}
      />,
    )
    act(flushFrames)

    act(() => dispatchTransition('transitionstart', 'width'))
    expect(frames.size).toBe(1)

    act(() => {
      const pending = [...frames.values()]
      frames = new Map()
      for (const callback of pending) callback(performance.now())
    })
    expect(frames.size).toBe(1)

    act(() => dispatchTransition('transitionend', 'width'))
    act(flushFrames)
    expect(frames.size).toBe(0)
  })
})
