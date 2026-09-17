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

  it('rolls minutes into hours past sixty', () => {
    expect(formatCompactDuration(4_830_000)).toBe('1h 20m 30s')
    expect(formatCompactDuration(4_830_000, 'zh')).toBe('1小时 20分 30秒')
  })
})
