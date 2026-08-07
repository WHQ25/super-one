import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  AUTO_RECAP_RETRY_INTERVAL_MS,
  FocusTracker,
  LOSE_DEBOUNCE_MS,
  installAcpRecapFocus,
  notifySessionRecapReceived,
  type AcpRecapFocusController,
} from './acp-recap-focus'

describe('FocusTracker', () => {
  it('is focused by default and not recap-due', () => {
    const t = new FocusTracker(30_000, () => 0)
    expect(t.isFocused()).toBe(true)
    expect(t.recapDue()).toBe(false)
  })

  it('is not due immediately after focus lost', () => {
    let now = 1_000
    const t = new FocusTracker(30_000, () => now)
    t.onFocusLost()
    expect(t.isFocused()).toBe(false)
    expect(t.recapDue()).toBe(false)
  })

  it('is due after away threshold', () => {
    let now = 1_000
    const t = new FocusTracker(5_000, () => now)
    t.onFocusLost()
    now = 1_000 + 5_000
    expect(t.recapDue()).toBe(true)
  })

  it('stops after markRecapShown until a new away period', () => {
    let now = 0
    const t = new FocusTracker(0, () => now)
    t.onFocusLost()
    expect(t.recapDue()).toBe(true)
    t.markRecapShown()
    expect(t.recapDue()).toBe(false)
    t.onFocusGained()
    t.onFocusLost()
    now = 1
    expect(t.recapDue()).toBe(true)
  })

  it('backs off after successful endRecapRequest until retry interval', () => {
    let now = 0
    const t = new FocusTracker(0, () => now)
    t.onFocusLost()
    expect(t.recapDue()).toBe(true)
    expect(t.beginRecapRequest()).toBe(true)
    expect(t.recapDue()).toBe(false)
    t.endRecapRequest(true)
    expect(t.recapDue()).toBe(false)
    now = AUTO_RECAP_RETRY_INTERVAL_MS - 1
    expect(t.recapDue()).toBe(false)
    now = AUTO_RECAP_RETRY_INTERVAL_MS
    expect(t.recapDue()).toBe(true)
  })

  it('does not backoff when endRecapRequest(sent=false)', () => {
    let now = 0
    const t = new FocusTracker(0, () => now)
    t.onFocusLost()
    t.beginRecapRequest()
    t.endRecapRequest(false)
    expect(t.recapDue()).toBe(true)
  })

  it('preserves shown when recap lands during pending lose debounce', () => {
    let now = 0
    const t = new FocusTracker(0, () => now)
    t.onFocusGained()
    t.markPendingLose()
    t.markRecapShown()
    t.onFocusLost()
    expect(t.isFocused()).toBe(false)
    // Still marked shown — would not re-request immediately.
    expect(t.recapDue()).toBe(false)
  })
})

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
    // Second poll while first still pending must not start another RPC.
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
    // Still due — skip did not burn 90s backoff.
    expect(controller!.getTracker('sid').recapDue()).toBe(true)
  })

  it('preserves mark-shown when recap arrives during lose debounce', async () => {
    vi.useFakeTimers()
    // Establish away so a recap could be in flight from a prior period.
    controller!.onSessionForeground('sid', false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    controller!.onSessionForeground('sid', true)
    await Promise.resolve()
    requests.mockClear()
    // Leave again; recap from prior request lands mid-debounce.
    controller!.onSessionForeground('sid', false)
    controller!.markRecapShown('sid')
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(controller!.getTracker('sid').isFocused()).toBe(false)
    // Must not be due again immediately (shown preserved across pending-lose).
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
})
