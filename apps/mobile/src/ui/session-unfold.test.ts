import { describe, expect, it } from 'vitest'
import { SESSION_UNFOLD, sessionUnfoldDelay, sessionUnfoldHeightMs } from './session-unfold'

describe('sessionUnfoldDelay', () => {
  it('holds 40ms then staggers 24ms per row', () => {
    expect(sessionUnfoldDelay(0)).toBe(SESSION_UNFOLD.rowDelayMs)
    expect(sessionUnfoldDelay(1)).toBe(64)
    expect(sessionUnfoldDelay(5)).toBe(160)
  })
})

describe('sessionUnfoldHeightMs', () => {
  it('collapses faster than it opens', () => {
    expect(sessionUnfoldHeightMs(false)).toBe(240)
    expect(sessionUnfoldHeightMs(true)).toBe(180)
  })
})
