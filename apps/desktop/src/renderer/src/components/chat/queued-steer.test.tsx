/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOUBLE_ENTER_STEER_MS, QUEUED_SEND_DELAY_MS, useDoubleEnterSteer } from './queued-steer'

vi.mock('@/hooks/use-environment-serves', () => ({ useEnvironmentServes: () => true }))

describe('useDoubleEnterSteer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('steers directly without a queued send when a second Enter arrives within the send delay', () => {
    const dispatch = vi.fn()
    const onSteer = vi.fn()
    const { result } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(dispatch, onSteer, true) })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(QUEUED_SEND_DELAY_MS - 1) })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { expect(result.current.steer()).toBe(true) })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(true)
    expect(onSteer).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(DOUBLE_ENTER_STEER_MS) })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('dispatches after the send delay and promotes to steer if a second Enter arrives before the window expires', () => {
    const dispatch = vi.fn()
    const onSteer = vi.fn()
    const { result } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(dispatch, onSteer, true) })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(QUEUED_SEND_DELAY_MS) })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(false)
    expect(onSteer).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(DOUBLE_ENTER_STEER_MS - QUEUED_SEND_DELAY_MS - 1) })
    act(() => { expect(result.current.steer()).toBe(true) })
    expect(onSteer).toHaveBeenCalledOnce()
    act(() => { expect(result.current.steer()).toBe(false) })
  })

  it('expires the steer window once the timeout passes without steering', () => {
    const dispatch = vi.fn()
    const onSteer = vi.fn()
    const { result } = renderHook(() => useDoubleEnterSteer(true))
    act(() => { result.current.submit(dispatch, onSteer, true) })
    act(() => { vi.advanceTimersByTime(DOUBLE_ENTER_STEER_MS) })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(false)
    act(() => { expect(result.current.steer()).toBe(false) })
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('sends immediately when steering is unavailable or not triggered from Enter', () => {
    const dispatch = vi.fn()
    const onSteer = vi.fn()
    const disabled = renderHook(() => useDoubleEnterSteer(false))
    act(() => { disabled.result.current.submit(dispatch, onSteer, true) })
    act(() => { expect(disabled.result.current.steer()).toBe(false) })
    const enabled = renderHook(() => useDoubleEnterSteer(true))
    act(() => { enabled.result.current.submit(dispatch, onSteer, false) })
    act(() => { expect(enabled.result.current.steer()).toBe(false) })
    expect(dispatch.mock.calls).toEqual([[false], [false]])
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('flushes an undispatched send as normal on a new submit, disable, or unmount', () => {
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    const onSteer = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDoubleEnterSteer(enabled),
      { initialProps: { enabled: true } },
    )
    act(() => { result.current.submit(first, onSteer, true) })
    act(() => { result.current.submit(second, onSteer, true) })
    expect(first).toHaveBeenCalledExactlyOnceWith(false)

    rerender({ enabled: false })
    expect(second).toHaveBeenCalledExactlyOnceWith(false)

    rerender({ enabled: true })
    act(() => { result.current.submit(third, onSteer, true) })
    unmount()
    expect(third).toHaveBeenCalledExactlyOnceWith(false)
    expect(onSteer).not.toHaveBeenCalled()
  })
})
