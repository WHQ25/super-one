import { describe, expect, it } from 'vitest'
import {
  compareFoldLoad,
  firstScreenMs,
  formatDuration,
  kbpsToSlider,
  sliderToKbps,
  transferMs,
} from './fold-load-compare'

describe('fold first-screen load', () => {
  const comparison = compareFoldLoad()

  it('spends the unfolded window on the last turn and fits the folded session', () => {
    expect(comparison.plain.messages).toBe(1)
    expect(comparison.plain.older).toBe(true)
    expect(comparison.plain.fragments).toBeLessThan(comparison.budget.maxFragments)
    expect(comparison.plain.bytes).toBeGreaterThan(100_000)
    expect(comparison.folded.messages).toBe(comparison.turns * 2)
    expect(comparison.folded.older).toBe(false)
    expect(comparison.folded.folds).toBe(comparison.turns)
    expect(comparison.folded.bytes).toBeLessThan(10_000)
    expect(comparison.plain.reply).toBe(true)
    expect(comparison.folded.reply).toBe(true)
    expect(comparison.plain.rows).toHaveLength(1)
    expect(comparison.plain.rows[0]?.content.some((block) => block.type === 'tool_result')).toBe(true)
    expect(comparison.folded.rows.some((row) => row.content.some((block) => block.type === 'notice' && block.kind === 'fold'))).toBe(true)
    expect(comparison.plain.bytes / comparison.folded.bytes).toBeGreaterThan(15)
  })

  it('adds one round trip to the transfer', () => {
    expect(transferMs(400, 400)).toBe(8)
    expect(firstScreenMs(comparison.plain.bytes, 400, 400)).toBeCloseTo(400 + (comparison.plain.bytes * 8) / 400, 5)
    expect(firstScreenMs(comparison.folded.bytes, 400, 400)).toBeLessThan(firstScreenMs(comparison.plain.bytes, 400, 400) / 4)
    expect(firstScreenMs(1000, 0, 40)).toBe(Number.POSITIVE_INFINITY)
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('maps the speed slider across the allowed range', () => {
    expect(sliderToKbps(0)).toBe(50)
    expect(sliderToKbps(1000)).toBe(100_000)
    expect(sliderToKbps(kbpsToSlider(1_600))).toBe(1_600)
  })
})
