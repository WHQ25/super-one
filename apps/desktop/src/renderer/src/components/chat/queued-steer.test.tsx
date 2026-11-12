/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOUBLE_ENTER_STEER_MS, useDoubleEnterSteer } from './queued-steer'

vi.mock('@/hooks/use-environment-serves', () => ({ useEnvironmentServes: () => true }))

describe('useDoubleEnterSteer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('steers a held send when a second Enter follows within the window', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(dispatch, true) })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { result.current.steer() })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(true)
    act(() => { vi.advanceTimersByTime(DOUBLE_ENTER_STEER_MS) })
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('queues a held send normally once the window passes', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(dispatch, true) })
    act(() => { vi.advanceTimersByTime(DOUBLE_ENTER_STEER_MS) })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(false)
    act(() => { result.current.steer() })
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('sends immediately when steering is unavailable or the send is not held', () => {
    const dispatch = vi.fn()
    const disabled = renderHook(() => useDoubleEnterSteer(false))
    act(() => { disabled.result.current.submit(dispatch, true) })
    const enabled = renderHook(() => useDoubleEnterSteer(true))
    act(() => { enabled.result.current.submit(dispatch, false) })
    expect(dispatch.mock.calls).toEqual([[false], [false]])
  })

  it('flushes a held send as a normal send before the next one or on unmount', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, unmount } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(first, true) })
    act(() => { result.current.submit(second, true) })
    expect(first).toHaveBeenCalledExactlyOnceWith(false)
    unmount()
    expect(second).toHaveBeenCalledExactlyOnceWith(false)
  })
})
