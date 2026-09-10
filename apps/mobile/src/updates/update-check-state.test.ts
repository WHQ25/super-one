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

  it('lets an explicit check skip the interval but not the re-entry guard', () => {
    // Tapping "Check for updates" should feel immediate...
    expect(
      shouldCheckNow({ lastCheckedAtMs: NOW - UPDATE_REENTRY_GUARD_MS, nowMs: NOW, force: true }),
    ).toBe(true)
    // ...but coming straight back from the system installer must not re-arm
    // the whole prompt-and-download cycle.
    expect(shouldCheckNow({ lastCheckedAtMs: NOW - 1000, nowMs: NOW, force: true })).toBe(false)
  })

  it('recovers from a clock that moved backwards', () => {
    // A stored stamp in the future would otherwise suppress every future check.
    expect(shouldCheckNow({ lastCheckedAtMs: NOW + 60_000, nowMs: NOW })).toBe(true)
  })
})
