import { describe, expect, it } from 'vitest'
import {
  shouldCheckNow,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_REENTRY_GUARD_MS,
} from './update-check-state'

const NOW = 1_800_000_000_000

describe('shouldCheckNow', () => {
  it('checks on a first run', () => {
    expect(shouldCheckNow({ lastCheckedAtMs: null, nowMs: NOW })).toBe(true)
  })

  it('waits out the interval on a background check', () => {
    expect(shouldCheckNow({ lastCheckedAtMs: NOW - 1000, nowMs: NOW })).toBe(false)
    expect(
      shouldCheckNow({ lastCheckedAtMs: NOW - UPDATE_CHECK_INTERVAL_MS, nowMs: NOW }),
    ).toBe(true)
  })

  it('lets an explicit check skip both automatic-check throttles', () => {
    expect(
      shouldCheckNow({ lastCheckedAtMs: NOW - UPDATE_REENTRY_GUARD_MS, nowMs: NOW, force: true }),
    ).toBe(true)
    expect(shouldCheckNow({ lastCheckedAtMs: NOW - 1000, nowMs: NOW, force: true })).toBe(true)
    expect(shouldCheckNow({ lastCheckedAtMs: NOW, nowMs: NOW, force: true })).toBe(true)
  })

  it('recovers from a clock that moved backwards', () => {
    // A stored stamp in the future would otherwise suppress every future check.
    expect(shouldCheckNow({ lastCheckedAtMs: NOW + 60_000, nowMs: NOW })).toBe(true)
  })
})
