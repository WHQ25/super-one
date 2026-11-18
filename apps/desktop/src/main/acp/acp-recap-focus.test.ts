import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import log from '../logger'
import { controlLeaseAuthority } from '../control-lease.test-fixtures'
import { runWindowControl } from '../session/control-context'
import { SessionLease } from '../session/session-lease'
import {
  AWAY_RECAP_POLL_MS,
  LOSE_DEBOUNCE_MS,
  claimAutoRecapDispatch,
  finishAutoRecapDispatch,
  installAcpRecapFocus,
  notifySessionRecapForeground,
  notifySessionRecapReceived,
  type AcpRecapFocusController,
} from './acp-recap-focus'

describe('installAcpRecapFocus (per-session)', () => {
  let controller: AcpRecapFocusController | null = null
  let now = 0
  const requests = vi.fn(async (_sessionId: string) => true)

  beforeEach(() => {
    now = 0
    requests.mockReset()
    requests.mockImplementation(async () => true)
    controller = installAcpRecapFocus({
      requestAutoRecap: requests,
      recapThresholdSecs: 0,
      now: () => now,
    })
  })

  afterEach(() => {
    controller?.dispose()
    controller = null
    vi.useRealTimers()
  })

  it('requests auto recap for the session that regained foreground after away', async () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('sid-a', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(controller!.getTracker('sid-a').recapDue()).toBe(true)
    controller!.onSessionForeground('sid-a', true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledWith('sid-a')
  })

  it('does not request for a different session that stayed focused', async () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('sid-a', true)
    controller!.onSessionForeground('sid-b', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.onSessionForeground('sid-b', true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledWith('sid-b')
  })

  it('pregenerates only for away sessions', async () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('away', false)
    controller!.onSessionForeground('focused', true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.maybePregenerate()
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledWith('away')
  })

  it('debounces brief unmount so quick remount does not start an away period', () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('sid', false)
    controller!.onSessionForeground('sid', true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(controller!.getTracker('sid').isFocused()).toBe(true)
    expect(requests).not.toHaveBeenCalled()
  })

  it('markRecapShown is per-session and ignores empty id at runtime', () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('a', false)
    controller!.onSessionForeground('b', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    notifySessionRecapReceived('a')
    notifySessionRecapReceived('   ')
    expect(controller!.getTracker('a').recapDue()).toBe(false)
    expect(controller!.getTracker('b').recapDue()).toBe(true)
  })

  it('does not double-fire while a request is in flight', async () => {
    vi.useFakeTimers()
    let resolveReq!: (v: boolean) => void
    requests.mockImplementation(
      () => new Promise<boolean>((r) => { resolveReq = r }),
    )
    controller!.onSessionForeground('sid', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.maybePregenerate()
    expect(requests).toHaveBeenCalledTimes(1)
    controller!.maybePregenerate()
    expect(requests).toHaveBeenCalledTimes(1)
    resolveReq(true)
    await Promise.resolve()
  })

  it('does not note attempt backoff when request is skipped', async () => {
    vi.useFakeTimers()
    requests.mockImplementation(async () => false)
    controller!.onSessionForeground('sid', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(controller!.getTracker('sid').recapDue()).toBe(true)
    controller!.maybePregenerate()
    await Promise.resolve()
    expect(controller!.getTracker('sid').recapDue()).toBe(true)
  })

  it('preserves mark-shown when recap arrives during lose debounce', async () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('sid', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.onSessionForeground('sid', true)
    await Promise.resolve()
    requests.mockClear()
    controller!.onSessionForeground('sid', false)
    controller!.markRecapShown('sid')
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(controller!.getTracker('sid').isFocused()).toBe(false)
    expect(controller!.getTracker('sid').recapDue()).toBe(false)
  })

  it('removeSession drops tracker so poll does not keep calling', async () => {
    vi.useFakeTimers()
    controller!.onSessionForeground('gone', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.removeSession('gone')
    controller!.maybePregenerate()
    await Promise.resolve()
    expect(requests).not.toHaveBeenCalled()
  })

  it('shares in-flight and backoff with remote auto recap claims', () => {
    expect(claimAutoRecapDispatch('sid')).toBe(true)
    expect(claimAutoRecapDispatch('sid')).toBe(false)
    finishAutoRecapDispatch('sid', true)
    expect(claimAutoRecapDispatch('sid')).toBe(false)
  })

  it('detaches notifySessionRecapForeground timers from window ControlScope so away polls do not acquire or expire leases', async () => {
    const authority = controlLeaseAuthority()
    const lease = new SessionLease('sid-lease', authority)

    controller?.dispose()
    vi.mocked(log.info).mockClear()
    controller = installAcpRecapFocus({
      recapThresholdSecs: 0,
      requestAutoRecap: async () => {
        lease.assertMutation()
        return false
      },
    })

    runWindowControl(7, () => {
      notifySessionRecapForeground('sid-lease', false)
    })

    await new Promise((resolve) => setTimeout(resolve, LOSE_DEBOUNCE_MS + 20))
    runWindowControl(7, () => {
      notifySessionRecapForeground('sid-lease', true)
    })
    await Promise.resolve()

    expect(lease.current).toBeNull()
    expect(log.info).not.toHaveBeenCalled()
  })
})
