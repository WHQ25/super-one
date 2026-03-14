import { getStallLevel, getStallColor } from './stall-utils'

describe('getStallLevel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return normal when lastEventAt is 0', () => {
    expect(getStallLevel(0)).toBe('normal')
  })

  it('should return normal when gap is under 60 seconds', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(getStallLevel(now - 30_000)).toBe('normal')
  })

  it('should return warning when gap is between 60-120 seconds', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(getStallLevel(now - 90_000)).toBe('warning')
  })

  it('should return critical when gap is 120+ seconds', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(getStallLevel(now - 150_000)).toBe('critical')
  })

  it('should return normal at exactly just under 60s', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(getStallLevel(now - 59_999)).toBe('normal')
  })

  it('should return warning at exactly 60s', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(getStallLevel(now - 60_000)).toBe('warning')
  })
})

describe('getStallColor', () => {
  it('should return text-red-500 for critical', () => {
    expect(getStallColor('critical')).toBe('text-red-500')
  })

  it('should return text-amber-500 for warning', () => {
    expect(getStallColor('warning')).toBe('text-amber-500')
  })

  it('should return text-muted-foreground for normal', () => {
    expect(getStallColor('normal')).toBe('text-muted-foreground')
  })
})
