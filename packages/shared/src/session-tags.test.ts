import { describe, expect, it } from 'vitest'
import {
  applySessionTagOp,
  normalizeSessionTag,
  normalizeSessionTagList,
  parseSessionTagMatch,
  parseSessionTagOp,
  parseTagsJson,
  sessionTagsMatchClause,
} from './session-tags'

describe('normalizeSessionTag', () => {
  it('lowercases, trims, and collapses whitespace to hyphens', () => {
    expect(normalizeSessionTag('  OAuth Refresh  ')).toBe('oauth-refresh')
  })

  it('accepts CJK', () => {
    expect(normalizeSessionTag('认证')).toBe('认证')
  })

  it('rejects empty, too long, and punctuation', () => {
    expect(normalizeSessionTag('')).toBeNull()
    expect(normalizeSessionTag('   ')).toBeNull()
    expect(normalizeSessionTag('a'.repeat(33))).toBeNull()
    expect(normalizeSessionTag('foo_bar')).toBeNull()
    expect(normalizeSessionTag('foo/bar')).toBeNull()
  })
})

describe('normalizeSessionTagList', () => {
  it('de-dupes after normalize and preserves first-seen order', () => {
    expect(normalizeSessionTagList(['OAuth', 'auth', 'oauth'])).toEqual({
      tags: ['oauth', 'auth'],
    })
  })

  it('rejects more than 8 tags', () => {
    const raw = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    expect(normalizeSessionTagList(raw)).toMatchObject({ error: expect.stringMatching(/at most 8/) })
  })
})

describe('parseSessionTagOp', () => {
  it('requires exactly one of add/remove/set', () => {
    expect(parseSessionTagOp({})).toMatchObject({ error: expect.stringMatching(/exactly one/) })
    expect(parseSessionTagOp({ add: ['a'], set: [] })).toMatchObject({
      error: expect.stringMatching(/exactly one/),
    })
  })

  it('parses set including empty clear', () => {
    expect(parseSessionTagOp({ set: [] })).toEqual({ kind: 'set', tags: [] })
    expect(parseSessionTagOp({ set: ['Auth'] })).toEqual({ kind: 'set', tags: ['auth'] })
  })
})

describe('applySessionTagOp', () => {
  it('adds without exceeding the cap', () => {
    expect(applySessionTagOp(['oauth'], { kind: 'add', tags: ['auth'] })).toEqual(['oauth', 'auth'])
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(applySessionTagOp(full, { kind: 'add', tags: ['i'] })).toMatchObject({
      error: expect.stringMatching(/at most 8/),
    })
  })

  it('removes and sets', () => {
    expect(applySessionTagOp(['oauth', 'auth'], { kind: 'remove', tags: ['oauth'] })).toEqual(['auth'])
    expect(applySessionTagOp(['oauth'], { kind: 'set', tags: [] })).toEqual([])
  })
})

describe('sessionTagsMatchClause', () => {
  it('returns empty for no tags', () => {
    expect(sessionTagsMatchClause('s.tags_json', [], 'any')).toEqual({ sql: '', params: [] })
  })

  it('builds any as EXISTS IN and all as distinct count', () => {
    const any = sessionTagsMatchClause('s.tags_json', ['oauth', 'auth'], 'any')
    expect(any.sql).toMatch(/EXISTS/)
    expect(any.sql).toMatch(/json_each/)
    expect(any.params).toEqual(['oauth', 'auth'])

    const all = sessionTagsMatchClause('s.tags_json', ['oauth', 'auth'], 'all')
    expect(all.sql).toMatch(/COUNT\(DISTINCT value\)/)
    expect(all.params).toEqual(['oauth', 'auth', 2])
  })
})

describe('parseTagsJson / parseSessionTagMatch', () => {
  it('parses json arrays and defaults match to any', () => {
    expect(parseTagsJson('["oauth","auth"]')).toEqual(['oauth', 'auth'])
    expect(parseTagsJson(['oauth'])).toEqual(['oauth'])
    expect(parseTagsJson('nope')).toEqual([])
    expect(parseSessionTagMatch(undefined)).toBe('any')
    expect(parseSessionTagMatch('all')).toBe('all')
    expect(parseSessionTagMatch('or')).toBeNull()
  })
})
