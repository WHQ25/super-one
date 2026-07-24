import { describe, expect, it } from 'vitest'
import {
  formatApprovedPlanReviewMessage,
  formatPlanFeedback,
  inlinePlanSnippets,
  normalizeLineRange,
  splitPlanLines,
} from './plan-feedback'

const PLAN = '# Title\n\n- step A\n- step B\n- step C'

describe('splitPlanLines / snippets', () => {
  it('splits on newlines', () => {
    expect(splitPlanLines(PLAN)).toEqual(['# Title', '', '- step A', '- step B', '- step C'])
  })

  it('quotes inclusive line range as Grok does', () => {
    expect(inlinePlanSnippets(PLAN, 3, 4)).toBe('> - step A\n> - step B')
    expect(inlinePlanSnippets(PLAN, 1, 1)).toBe('> # Title')
  })

  it('handles out-of-range', () => {
    expect(inlinePlanSnippets(PLAN, 0, 1)).toBe('> [selected lines unavailable]')
    expect(inlinePlanSnippets(PLAN, 99, 100)).toBe('> [selected lines unavailable]')
  })
})

describe('formatPlanFeedback', () => {
  it('returns empty when nothing provided', () => {
    expect(formatPlanFeedback(PLAN, [], '')).toBe('')
    expect(formatPlanFeedback(PLAN, [{ id: '1', startLine: 1, endLine: 1, text: '  ' }], '  ')).toBe('')
  })

  it('formats a single line comment with snippet', () => {
    const out = formatPlanFeedback(PLAN, [
      { id: '1', startLine: 3, endLine: 3, text: 'make async' },
    ])
    expect(out).toBe(
      'Proposed plan line 3:\n> - step A\n\nComment:\nmake async',
    )
  })

  it('formats a multi-line comment', () => {
    const out = formatPlanFeedback(PLAN, [
      { id: '1', startLine: 3, endLine: 5, text: 'reorder' },
    ])
    expect(out).toContain('Proposed plan lines 3-5:')
    expect(out).toContain('> - step A')
    expect(out).toContain('> - step C')
    expect(out).toContain('Comment:\nreorder')
  })

  it('freeform alone is bare text', () => {
    expect(formatPlanFeedback(PLAN, [], 'overall note')).toBe('overall note')
  })

  it('freeform after comments is labeled Additional feedback', () => {
    const out = formatPlanFeedback(
      PLAN,
      [{ id: '1', startLine: 1, endLine: 1, text: 'title ok' }],
      'overall note',
    )
    expect(out).toContain('Comment:\ntitle ok')
    expect(out).toContain('Additional feedback:\noverall note')
  })

  it('joins multiple comments with blank lines', () => {
    const out = formatPlanFeedback(PLAN, [
      { id: '1', startLine: 3, endLine: 3, text: 'a' },
      { id: '2', startLine: 5, endLine: 5, text: 'b' },
    ])
    expect(out.split('\n\n').length).toBeGreaterThanOrEqual(3)
    expect(out).toContain('Comment:\na')
    expect(out).toContain('Comment:\nb')
  })
})

describe('formatApprovedPlanReviewMessage', () => {
  it('wraps non-empty feedback', () => {
    expect(formatApprovedPlanReviewMessage('line note')).toBe(
      'The user approved the plan with the following review comments:\n\nline note',
    )
  })

  it('returns empty for blank', () => {
    expect(formatApprovedPlanReviewMessage('  ')).toBe('')
  })
})

describe('normalizeLineRange', () => {
  it('orders start/end', () => {
    expect(normalizeLineRange(5, 2)).toEqual({ startLine: 2, endLine: 5 })
    expect(normalizeLineRange(2, 5)).toEqual({ startLine: 2, endLine: 5 })
  })
})
