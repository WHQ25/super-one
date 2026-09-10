import { describe, expect, it } from 'vitest'
import { formatBuildLabel, formatDownloadPercent, formatUpdateSize } from './update-format'

describe('formatBuildLabel', () => {
  it('pairs the version with the build a tester would quote', () => {
    expect(formatBuildLabel('1.1.0', 48)).toBe('1.1.0 (48)')
  })

  it('degrades rather than printing null', () => {
    expect(formatBuildLabel('1.1.0', null)).toBe('1.1.0')
    expect(formatBuildLabel(null, 48)).toBe('(48)')
    expect(formatBuildLabel(null, null)).toBe('—')
  })
})

describe('formatUpdateSize', () => {
  it('quotes decimal megabytes, the way download UIs do', () => {
    expect(formatUpdateSize(96_468_992)).toBe('96 MB')
    expect(formatUpdateSize(9_400_000)).toBe('9.4 MB')
  })

  it('drops to KB below a megabyte and refuses nonsense', () => {
    expect(formatUpdateSize(400_000)).toBe('400 KB')
    expect(formatUpdateSize(0)).toBe('—')
    expect(formatUpdateSize(Number.NaN)).toBe('—')
  })
})

describe('formatDownloadPercent', () => {
  it('rounds and clamps', () => {
    expect(formatDownloadPercent(0.456)).toBe('46%')
    expect(formatDownloadPercent(0)).toBe('0%')
    expect(formatDownloadPercent(1.5)).toBe('100%')
  })

  it('says nothing rather than 0% when the total is unknown', () => {
    expect(formatDownloadPercent(null)).toBe('—')
  })
})
