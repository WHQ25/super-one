import { describe, expect, it } from 'vitest'
import { formatStarCount } from './format-star-count'

describe('formatStarCount', () => {
  it('keeps small counts as integers', () => {
    expect(formatStarCount(0)).toBe('0')
    expect(formatStarCount(999)).toBe('999')
  })

  it('uses one decimal below 10k and rounds at 10k+', () => {
    expect(formatStarCount(1200)).toBe('1.2k')
    expect(formatStarCount(10_400)).toBe('10k')
  })

  it('uses millions past 1m', () => {
    expect(formatStarCount(1_500_000)).toBe('1.5m')
    expect(formatStarCount(12_000_000)).toBe('12m')
  })
})
