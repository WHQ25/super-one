import { describe, expect, it } from 'vitest'
import { formatDurationRange } from './trajectory-format'


describe('formatDurationRange', () => {
  it('states both ends in one unit chosen by the larger of them', () => {
    expect(formatDurationRange(4_000, 10_000)).toBe('4–10s')
    expect(formatDurationRange(120, 640)).toBe('120–640ms')
    // A range that crosses into minutes reads in minutes at both ends, rather
    // than mixing "45s" with "1.5m".
    expect(formatDurationRange(45_000, 90_000)).toBe('0.8–1.5m')
  })

  it('keeps a fractional end but drops a trailing zero', () => {
    expect(formatDurationRange(4_500, 10_000)).toBe('4.5–10s')
  })

  it('reports unknown timing rather than a fabricated zero', () => {
    expect(formatDurationRange(Number.NaN, 10_000)).toBe('—')
  })
})
