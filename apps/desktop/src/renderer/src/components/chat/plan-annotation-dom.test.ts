import { describe, expect, it } from 'vitest'
import { quoteFromLines } from './plan-annotation-dom'

describe('quoteFromLines', () => {
  const plan = '# Title\n\n- step A\n- step B'

  it('joins inclusive line span', () => {
    expect(quoteFromLines(plan, 3, 4)).toBe('- step A\n- step B')
  })

  it('returns empty when out of range', () => {
    expect(quoteFromLines(plan, 0, 1)).toBe('')
    expect(quoteFromLines(plan, 99, 100)).toBe('')
  })
})
