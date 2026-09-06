import { describe, expect, it } from 'vitest'
import { IME_SETTLE_MS, mergeMentionItems, shouldSubmitFromKeyboard } from './composer-state'

describe('composer state', () => {
  it('blocks keyboard submit during the IME commit window', () => {
    expect(shouldSubmitFromKeyboard({ hasContent: true, lastTextChangeAt: 1_000, now: 1_000 + IME_SETTLE_MS - 1 })).toBe(false)
    expect(shouldSubmitFromKeyboard({ hasContent: true, lastTextChangeAt: 1_000, now: 1_000 + IME_SETTLE_MS })).toBe(true)
    expect(shouldSubmitFromKeyboard({ hasContent: false, lastTextChangeAt: 0, now: 10_000 })).toBe(false)
  })

  it('includes capabilities before remote results without inventing provider targets', () => {
    expect(mergeMentionItems('co', []).map((item) => item.path)).toEqual([])
    expect(mergeMentionItems('', [{ kind: 'file', path: 'src' }]).map((item) => item.path))
      .toEqual(['widget', 'debug', 'src'])
  })
})
