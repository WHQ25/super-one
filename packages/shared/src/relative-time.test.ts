import { describe, expect, it } from 'vitest'
import { formatCompactAge } from './relative-time'

const now = Date.parse('2026-06-15T12:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('formatCompactAge', () => {
  it('uses minutes, hours, days, weeks, months, then years', () => {
    expect(formatCompactAge(ago(30_000), { now })).toBe('')
    expect(formatCompactAge(ago(59_000), { now })).toBe('')
    expect(formatCompactAge(ago(60_000), { now })).toBe('1m')
    expect(formatCompactAge(ago(12 * 60_000), { now })).toBe('12m')
    expect(formatCompactAge(ago(5 * 3_600_000), { now })).toBe('5h')
    expect(formatCompactAge(ago(3 * 86_400_000), { now })).toBe('3d')
    expect(formatCompactAge(ago(7 * 86_400_000), { now })).toBe('1w')
    expect(formatCompactAge(ago(29 * 86_400_000), { now })).toBe('4w')
    expect(formatCompactAge(ago(30 * 86_400_000), { now })).toBe('1mo')
    expect(formatCompactAge(ago(360 * 86_400_000), { now })).toBe('1y')
    expect(formatCompactAge(ago(800 * 86_400_000), { now })).toBe('2y')
  })

  it('writes units in the given locale', () => {
    const zh = { locale: 'zh', now }
    expect(formatCompactAge(ago(12 * 60_000), zh)).toBe('12分钟')
    expect(formatCompactAge(ago(5 * 3_600_000), zh)).toBe('5小时')
    expect(formatCompactAge(ago(3 * 86_400_000), zh)).toBe('3天')
    expect(formatCompactAge(ago(7 * 86_400_000), zh)).toBe('1周')
    expect(formatCompactAge(ago(30 * 86_400_000), zh)).toBe('1个月')
    expect(formatCompactAge(ago(800 * 86_400_000), zh)).toBe('2年')
    expect(formatCompactAge(ago(30 * 86_400_000), { locale: 'en-GB', now })).toBe('1mo')
  })

  it('returns nothing for a missing time', () => {
    expect(formatCompactAge('', { now })).toBe('')
    expect(formatCompactAge('not-a-date', { now })).toBe('')
  })
})
