import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy-match'

describe('fuzzyMatch', () => {
  it('should match exact prefix', () => {
    const result = fuzzyMatch('com', 'commit')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([0, 1, 2])
  })

  it('should match non-contiguous characters', () => {
    const result = fuzzyMatch('cm', 'commit')
    expect(result.match).toBe(true)
    expect(result.indices).toContain(0)
  })

  it('should not match when characters are missing', () => {
    const result = fuzzyMatch('xyz', 'commit')
    expect(result.match).toBe(false)
  })

  it('should return empty indices for empty query', () => {
    const result = fuzzyMatch('', 'commit')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([])
  })

  it('should score prefix match higher than non-prefix', () => {
    const prefix = fuzzyMatch('co', 'commit')
    const nonPrefix = fuzzyMatch('mt', 'commit')
    expect(prefix.score).toBeGreaterThan(nonPrefix.score)
  })

  it('should score consecutive matches higher', () => {
    const consecutive = fuzzyMatch('com', 'commit')
    const scattered = fuzzyMatch('cmt', 'commit')
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('should be case insensitive', () => {
    const result = fuzzyMatch('CM', 'commit')
    expect(result.match).toBe(true)
  })

  it('should give case-exact bonus', () => {
    const exact = fuzzyMatch('C', 'Commit')
    const inexact = fuzzyMatch('c', 'Commit')
    expect(exact.score).toBeGreaterThan(inexact.score)
  })

  it('should match tdd in tdd', () => {
    const result = fuzzyMatch('tdd', 'tdd')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([0, 1, 2])
  })

  it('should match rev in review-pr', () => {
    const result = fuzzyMatch('rev', 'review-pr')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([0, 1, 2])
  })
})
