import { describe, expect, it } from 'vitest'
import { formatCompactDuration } from './duration-format'

describe('formatCompactDuration', () => {
  it('localizes Chinese duration units', () => {
    expect(formatCompactDuration(63_000, 'zh-CN')).toBe('1分 3秒')
    expect(formatCompactDuration(8_000, 'zh')).toBe('8秒')
  })

  it('keeps compact English duration units by default', () => {
    expect(formatCompactDuration(63_000)).toBe('1m 3s')
  })
})
