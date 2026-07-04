import { describe, it, expect } from 'vitest'
import { findActiveTurnId } from './ChatScrollIndicator'

const entries = (...ids: string[]) => ids.map((id) => ({ id }))

// tops keyed by id; missing key → null (element not mounted)
const topper = (tops: Record<string, number>) => (id: string) => (id in tops ? tops[id] : null)

describe('findActiveTurnId', () => {
  it('returns null for an empty outline', () => {
    expect(findActiveTurnId([], () => 0, 100)).toBeNull()
  })

  it('picks the last turn whose top is at or above the threshold', () => {
    const e = entries('a', 'b', 'c', 'd')
    const top = topper({ a: -50, b: 20, c: 80, d: 300 })
    // threshold 100 → a,b,c are above (<=100), d below → active = c
    expect(findActiveTurnId(e, top, 100)).toBe('c')
  })

  it('returns the first turn when all are below the threshold (scrolled to top)', () => {
    const e = entries('a', 'b', 'c')
    const top = topper({ a: 500, b: 700, c: 900 })
    expect(findActiveTurnId(e, top, 100)).toBe('a')
  })

  it('returns the last turn when all are above the threshold (scrolled to bottom)', () => {
    const e = entries('a', 'b', 'c')
    const top = topper({ a: -300, b: -200, c: -50 })
    expect(findActiveTurnId(e, top, 100)).toBe('c')
  })

  it('treats unmounted (null-top) leading turns as above the threshold', () => {
    const e = entries('a', 'b', 'c', 'd')
    // a,b not mounted (older, scrolled above); c above threshold, d below
    const top = topper({ c: 40, d: 400 })
    expect(findActiveTurnId(e, top, 100)).toBe('c')
  })

  it('handles a single entry', () => {
    expect(findActiveTurnId(entries('only'), topper({ only: 10 }), 100)).toBe('only')
    expect(findActiveTurnId(entries('only'), topper({ only: 999 }), 100)).toBe('only')
  })

  it('finds the boundary correctly for a larger monotonic list', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `t${i}`)
    const tops = Object.fromEntries(ids.map((id, i) => [id, i * 10 - 200]))
    // threshold 0 → tops <= 0 are i*10-200<=0 → i<=20 → last is t20
    expect(findActiveTurnId(entries(...ids), topper(tops), 0)).toBe('t20')
  })
})
