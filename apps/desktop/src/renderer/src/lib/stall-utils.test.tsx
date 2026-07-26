/** @vitest-environment jsdom */

import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStallLevel } from './stall-utils'

/**
 * A row that only needs a stall level must not *subscribe* to `lastEventAt` —
 * that field is rewritten on every content delta, so subscribing re-renders the
 * row at stream frequency. The getter form lets a caller read the value lazily
 * inside the hook's own 1s tick instead.
 */
describe('useStallLevel with a lazy source', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads the getter on each tick rather than on each render', () => {
    let now = Date.now()
    vi.setSystemTime(now)
    const read = vi.fn(() => now)

    const { result } = renderHook(() => useStallLevel(true, read))
    expect(result.current).toBe('normal')

    const callsAfterMount = read.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(read.mock.calls.length).toBeGreaterThan(callsAfterMount)
  })

  it('escalates to warning then critical as the getter value ages', () => {
    const start = Date.now()
    vi.setSystemTime(start)
    const read = () => start

    const { result } = renderHook(() => useStallLevel(true, read))
    expect(result.current).toBe('normal')

    act(() => { vi.setSystemTime(start + 61_000); vi.advanceTimersByTime(1000) })
    expect(result.current).toBe('warning')

    act(() => { vi.setSystemTime(start + 121_000); vi.advanceTimersByTime(1000) })
    expect(result.current).toBe('critical')
  })

  it('still accepts a plain number so existing callers are unaffected', () => {
    const start = Date.now()
    vi.setSystemTime(start)

    const { result } = renderHook(() => useStallLevel(true, start - 130_000))
    expect(result.current).toBe('critical')
  })

  it('reports normal and stops ticking while inactive', () => {
    const read = vi.fn(() => Date.now() - 200_000)

    const { result } = renderHook(() => useStallLevel(false, read))
    expect(result.current).toBe('normal')

    read.mockClear()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(read).not.toHaveBeenCalled()
  })
})
