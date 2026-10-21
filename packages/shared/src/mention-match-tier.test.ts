import { describe, expect, it } from 'vitest'
import {
  compareMentionMatchKeys,
  fileMentionMatchKey,
  fileMentionMatchTier,
  gitMentionRefMatchKey,
  gitMentionRefMatchTier,
  mentionMatchKey,
  mentionMatchTier,
  sortByMentionMatch,
} from './mention-match-tier'

describe('mentionMatchTier', () => {
  it('treats an empty query as a prefix match', () => {
    expect(mentionMatchTier('Anything', '')).toBe(0)
    expect(mentionMatchTier('Anything', '   ')).toBe(0)
  })

  it('ranks prefix, then a separator, then a substring, then a subsequence', () => {
    expect(mentionMatchTier('feat/popup', 'feat')).toBe(0)
    expect(mentionMatchTier('fix/feat-x', 'feat')).toBe(1)
    expect(mentionMatchTier('add-feat-flag', 'feat')).toBe(1)
    expect(mentionMatchTier('my feat', 'feat')).toBe(1)
    expect(mentionMatchTier('my_feat', 'feat')).toBe(1)
    expect(mentionMatchTier('my.feat', 'feat')).toBe(1)
    expect(mentionMatchTier('myfeat', 'feat')).toBe(2)
    expect(mentionMatchTier('Fix Auth Middleware', 'fxa')).toBe(3)
    expect(mentionMatchTier('Fix Auth Middleware', 'zzz')).toBeNull()
  })

  it('matches CJK by code point', () => {
    // 修…登 skips 复, so this is a subsequence. 复登 itself is a substring.
    expect(mentionMatchTier('修复登录', '修登')).toBe(3)
    expect(mentionMatchTier('修复登录', '登录')).toBe(2)
    expect(mentionMatchTier('修复登录', '登修')).toBeNull()
  })
})

describe('mentionMatchKey', () => {
  it('prefers a segment boundary, then a shorter segment, then a shorter text', () => {
    const branch = mentionMatchKey('feat/popup', 'feat')
    const directory = mentionMatchKey('features', 'feat')
    const exact = mentionMatchKey('feat', 'feat')
    const dashed = mentionMatchKey('feat-flag', 'feat')
    expect(branch).toMatchObject({ tier: 0, wholeSegment: 0, segmentLength: 4, textLength: 10 })
    expect(directory).toMatchObject({ tier: 0, wholeSegment: 1, segmentLength: 8, textLength: 8 })
    expect(exact).toMatchObject({ tier: 0, wholeSegment: 0, segmentLength: 4, textLength: 4 })
    expect(dashed).toMatchObject({ tier: 0, wholeSegment: 0, segmentLength: 4, textLength: 9 })
    expect(compareMentionMatchKeys(branch, directory)).toBeLessThan(0)
    expect(compareMentionMatchKeys(exact, dashed)).toBeLessThan(0)
    expect(compareMentionMatchKeys(dashed, branch)).toBeLessThan(0)
    expect(mentionMatchKey('feat/', 'feat')).toMatchObject({ tier: 0, wholeSegment: 0, segmentLength: 4 })
  })

  it('keeps a CJK substring ahead of a subsequence', () => {
    const contains = mentionMatchKey('修复登录', '登录')
    const subsequence = mentionMatchKey('修复登录', '修登')
    expect(contains).toMatchObject({ tier: 2, wholeSegment: 0, segmentLength: 4, textLength: 4 })
    expect(subsequence).toMatchObject({ tier: 3, wholeSegment: 1, segmentLength: 4 })
    expect(compareMentionMatchKeys(contains, subsequence)).toBeLessThan(0)
    expect(mentionMatchKey('修复登录', '登修')).toBeNull()
  })

  it('sorts stably, leaving an equal key in its incoming order', () => {
    const rows = [
      { title: 'features', at: 1 },
      { title: 'feat/popup', at: 2 },
      { title: 'feat/other', at: 3 },
    ]
    expect(sortByMentionMatch(rows, 'feat', (row) => row.title).map((row) => row.at)).toEqual([2, 3, 1])
  })
})

describe('fileMentionMatchKey', () => {
  it('scores a directory basename and falls through when only the path matches', () => {
    expect(fileMentionMatchKey('docs/features/', 'feat')).toMatchObject({ tier: 0, wholeSegment: 1, segmentLength: 8 })
    expect(fileMentionMatchKey('src/components', 'src/')).toMatchObject({ tier: 0, wholeSegment: 1, segmentLength: 3 })
    expect(fileMentionMatchKey('src/feat/index.ts', 'feat')).toMatchObject({ tier: 1, wholeSegment: 0, segmentLength: 4 })
  })
})

describe('gitMentionRefMatchKey', () => {
  it('puts a sha or issue number ahead of any title', () => {
    const sha = gitMentionRefMatchKey({ kind: 'commit', id: 'abc1234fff', label: 'abc1234', detail: 'unrelated' }, 'abc')
    const exact = mentionMatchKey('abc', 'abc')
    expect(compareMentionMatchKeys(sha, exact)).toBeLessThan(0)
    const number = gitMentionRefMatchKey({ kind: 'issue', id: '23', label: '#23', detail: 'Old crash' }, '#2')
    expect(compareMentionMatchKeys(number, exact)).toBeLessThan(0)
    expect(gitMentionRefMatchKey({ kind: 'commit', id: 'ffff', label: 'ffff', detail: 'refeature the parser' }, 'feat'))
      .toEqual(mentionMatchKey('refeature the parser', 'feat'))
  })
})

describe('fileMentionMatchTier', () => {
  it('prefers the basename and falls back to the path', () => {
    expect(fileMentionMatchTier('src/feat-flag.ts', 'feat')).toBe(0)
    expect(fileMentionMatchTier('src/feat/index.ts', 'feat')).toBe(1)
    expect(fileMentionMatchTier('src/index.ts', 'src')).toBe(0)
    expect(fileMentionMatchTier('notes.ts', 'zzz')).toBeNull()
  })
})

describe('gitMentionRefMatchTier', () => {
  it('scores a sha or issue number as a prefix and otherwise the title', () => {
    expect(gitMentionRefMatchTier({ kind: 'branch', id: 'feat/popup', label: 'feat/popup' }, 'feat')).toBe(0)
    expect(gitMentionRefMatchTier({ kind: 'commit', id: 'abc1234fff', label: 'abc1234', detail: 'unrelated' }, 'abc123')).toBe(0)
    expect(gitMentionRefMatchTier({ kind: 'commit', id: 'ffff', label: 'ffff', detail: 'refeature the parser' }, 'feat')).toBe(2)
    expect(gitMentionRefMatchTier({ kind: 'issue', id: '23', label: '#23', detail: 'Old crash' }, '2')).toBe(0)
    expect(gitMentionRefMatchTier({ kind: 'issue', id: '23', label: '#23', detail: 'Old crash' }, '#2')).toBe(0)
    expect(gitMentionRefMatchTier({ kind: 'pr', id: '7', label: '#7', detail: 'Please crash less' }, 'cr')).toBe(1)
  })
})
