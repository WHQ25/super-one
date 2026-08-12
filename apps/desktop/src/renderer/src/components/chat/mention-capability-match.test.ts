import { describe, expect, it } from 'vitest'
import {
  compareBuiltinMentionMatches,
  matchBuiltinMention,
} from './mention-capability-match'

describe('matchBuiltinMention', () => {
  it('prefers keyword prefix over display-name substring (se → session beats Computer Use)', () => {
    const session = matchBuiltinMention('session', ['Session', '会话'], 'se')
    const computer = matchBuiltinMention('computer', ['Computer Use'], 'se')

    expect(session?.rank).toBe(0)
    expect(computer?.rank).toBe(2)
    expect(compareBuiltinMentionMatches(
      { rank: session!.rank, keyword: 'session' },
      { rank: computer!.rank, keyword: 'computer' },
    )).toBeLessThan(0)
  })

  it('matches collab / computer / browser by id prefix', () => {
    expect(matchBuiltinMention('collab', ['Agents Collaboration'], 'co')?.rank).toBe(0)
    expect(matchBuiltinMention('computer', ['Computer Use'], 'comp')?.rank).toBe(0)
    expect(matchBuiltinMention('browser', ['Super Browser'], 'br')?.rank).toBe(0)
  })

  it('still allows display-name-only matches when id does not match', () => {
    const m = matchBuiltinMention('computer', ['Computer Use'], 'use')
    expect(m?.rank).toBe(2)
    expect(m?.labelIndices.length).toBeGreaterThan(0)
    expect(m?.keywordIndices).toEqual([])
  })

  it('returns empty match for blank query so all builtins stay visible', () => {
    expect(matchBuiltinMention('session', ['Session'], '')).toEqual({
      rank: 0,
      labelIndices: [],
      keywordIndices: [],
    })
  })

  it('returns null when neither keyword nor labels match', () => {
    expect(matchBuiltinMention('browser', ['Super Browser'], 'zzz')).toBeNull()
  })
})

describe('compareBuiltinMentionMatches', () => {
  it('orders id-prefix before label-only, then shorter keywords', () => {
    const items = [
      { rank: 2 as const, keyword: 'computer' },
      { rank: 0 as const, keyword: 'session' },
      { rank: 0 as const, keyword: 'collab' },
    ]
    items.sort(compareBuiltinMentionMatches)
    expect(items.map((i) => i.keyword)).toEqual(['collab', 'session', 'computer'])
  })
})
