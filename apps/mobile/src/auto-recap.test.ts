import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWAY_RECAP_POLL_MS, LOSE_DEBOUNCE_MS } from '@superone/shared/recap-focus'
import { createMobileAutoRecap, requestAutoSessionRecap } from './auto-recap'

describe('requestAutoSessionRecap', () => {
  it('sends auto true and treats ok as success', async () => {
    const request = vi.fn(async (cmd: { type: string; auto?: boolean }) => {
      expect(cmd).toMatchObject({ type: 'request_session_recap', sessionId: 'sid', projectPath: '/p', auto: true })
      return { ok: true }
    })
    await expect(requestAutoSessionRecap(request, 'sid', '/p')).resolves.toBe(true)
  })

  it('returns false when the host skips or the RPC throws', async () => {
    await expect(requestAutoSessionRecap(async () => ({ ok: false }), 'sid', '/p')).resolves.toBe(false)
    await expect(requestAutoSessionRecap(async () => { throw new Error('offline') }, 'sid', '/p')).resolves.toBe(false)
  })
})

describe('createMobileAutoRecap', () => {
  const requests = vi.fn(async (_sessionId: string, _projectPath: string) => true)
  let recap: ReturnType<typeof createMobileAutoRecap>

  beforeEach(() => {
    requests.mockReset()
    requests.mockImplementation(async () => true)
    recap = createMobileAutoRecap({
      requestAutoRecap: requests,
      recapThresholdSecs: 0,
    })
  })

  afterEach(() => {
    recap.dispose()
    vi.useRealTimers()
  })

  it('does not request recap for an ineligible session', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, false)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, false)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, false)
    await Promise.resolve()
    expect(requests).not.toHaveBeenCalled()
  })

  it('requests auto recap after leaving a Grok session past the away threshold', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync(null, true, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledWith('sid', '/p')
  })

  it('treats app background as away for the open session', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledWith('sid', '/p')
  })

  it('does not request recap while the app stays in the background', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    vi.advanceTimersByTime(AWAY_RECAP_POLL_MS * 2)
    await Promise.resolve()
    expect(requests).not.toHaveBeenCalled()
  })

  it('does not pregenerate while another chat is open — waits for return', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'a', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'b', projectPath: '/q' }, true, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.maybePregenerate()
    await Promise.resolve()
    expect(requests).not.toHaveBeenCalled()
    recap.sync({ sessionId: 'a', projectPath: '/p' }, true, true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests).toHaveBeenCalledWith('a', '/p')
  })

  it('debounces a brief background so a quick return does not start away', () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(recap.getTracker('sid').isFocused()).toBe(true)
    expect(requests).not.toHaveBeenCalled()
  })

  it('stops auto retries once a recap is shown', async () => {
    vi.useFakeTimers()
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.markRecapShown('sid')
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    await Promise.resolve()
    expect(requests).not.toHaveBeenCalled()
  })

  it('does not burn backoff when the host skips the RPC', async () => {
    vi.useFakeTimers()
    requests.mockImplementation(async () => false)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, true, true)
    await Promise.resolve()
    expect(requests).toHaveBeenCalledTimes(1)
    recap.sync({ sessionId: 'sid', projectPath: '/p' }, false, true)
    vi.advanceTimersByTime(LOSE_DEBOUNCE_MS)
    expect(recap.getTracker('sid').recapDue()).toBe(true)
  })
})
