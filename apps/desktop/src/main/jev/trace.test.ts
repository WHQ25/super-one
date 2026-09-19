import { describe, expect, it } from 'vitest'
import { topChoiceProbabilities, traceRequestState } from './trace'
import { noul, pick } from './test-fixtures'

describe('decision trace evidence', () => {
  it('retains passive display text and the exact preceding action', () => {
    const state = { page: { text: 'Calculator\nEdit field 12' }, elements: [{ index: '14', label: 'Equals' }], last_action: { label: 'Click [10] 2', changed_page: true } }
    expect(traceRequestState(state, [])).toEqual(state)
  })

  it('redacts full preset values and truncated echoes without mutating the request', () => {
    const value = 'private '.repeat(30)
    const state = { goal: `Fill ${value}`, page: { text: value }, elements: [{ value: value.slice(0, 120) }], presets: [{ key: 'Body', hint: value.slice(0, 80), field: 'Body field' }] }
    const traced = traceRequestState(state, [{ key: 'Body', value, field: 'Body field' }])
    expect(JSON.stringify(traced)).not.toContain('private')
    expect(traced).toMatchObject({ page: { text: '<redacted>' }, elements: [{ value: '<redacted>' }], presets: [{ key: 'Body', field: 'Body field', value: '<redacted>' }] })
    expect(state.page.text).toBe(value)
    expect(state.presets[0].hint).toBe(value.slice(0, 80))
  })

  it('records the three highest probabilities without losing their candidate keys', () => {
    const choice = { ...pick('b', ['a', 'b', 'c', 'd']), probabilities: { a: 0.1, b: 0.6, c: 0.25, d: 0.05 } }
    expect(topChoiceProbabilities({ click_target: choice, goal_satisfied: noul(0.1) })).toEqual({ click_target: [
      { choice: 'b', probability: 0.6 }, { choice: 'c', probability: 0.25 }, { choice: 'a', probability: 0.1 },
    ] })
  })
})
