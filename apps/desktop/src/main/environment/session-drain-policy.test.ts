import { describe, expect, it } from 'vitest'
import { shouldAbortRemoteSessionDrain } from './session-drain-policy'

describe('shouldAbortRemoteSessionDrain', () => {
  it('keeps waiting while connected / reconnecting', () => {
    for (const state of ['connected', 'connecting', 'backoff', 'disconnected', 'synchronizing', 'available'] as const) {
      expect(shouldAbortRemoteSessionDrain({ state })).toEqual({ abort: false })
    }
  })

  it('aborts when supervisor is blocked (auth never auto-recovers)', () => {
    expect(
      shouldAbortRemoteSessionDrain({ state: 'blocked', lastError: 'identity mismatch' }),
    ).toEqual({ abort: true, reason: 'identity mismatch' })
  })

  it('aborts when network is offline', () => {
    expect(shouldAbortRemoteSessionDrain({ state: 'offline' })).toEqual({
      abort: true,
      reason: 'network offline',
    })
  })

  it('aborts when the connection was removed entirely', () => {
    expect(shouldAbortRemoteSessionDrain(null, { hasClient: false })).toEqual({
      abort: true,
      reason: 'connection removed',
    })
  })

  it('keeps waiting when supervisor is missing but a client still exists', () => {
    expect(shouldAbortRemoteSessionDrain(undefined, { hasClient: true })).toEqual({
      abort: false,
    })
  })
})
