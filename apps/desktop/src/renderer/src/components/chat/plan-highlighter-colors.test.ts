import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHTER_PALETTE,
  highlighterForComment,
  highlighterForDraft,
  highlighterForIndex,
} from './plan-highlighter-colors'

describe('highlighter palette', () => {
  it('has six classic fluorescent colors', () => {
    expect(HIGHLIGHTER_PALETTE.map((s) => s.id)).toEqual([
      'yellow',
      'pink',
      'orange',
      'green',
      'blue',
      'purple',
    ])
  })

  it('cycles by index', () => {
    expect(highlighterForIndex(0).id).toBe('yellow')
    expect(highlighterForIndex(1).id).toBe('pink')
    expect(highlighterForIndex(6).id).toBe('yellow')
  })

  it('assigns by comment order', () => {
    const comments = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(highlighterForComment('a', comments).id).toBe('yellow')
    expect(highlighterForComment('b', comments).id).toBe('pink')
    expect(highlighterForComment('c', comments).id).toBe('orange')
  })

  it('draft uses next slot after existing comments', () => {
    expect(highlighterForDraft(0).id).toBe('yellow')
    expect(highlighterForDraft(2).id).toBe('orange')
  })
})
