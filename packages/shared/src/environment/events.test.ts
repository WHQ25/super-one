import { describe, expect, it } from 'vitest'
import { compareSequences, nextSequence, sequenceToNumber } from './events'

describe('event sequences', () => {
  it('parses and compares decimal sequences', () => {
    expect(sequenceToNumber('0')).toBe(0n)
    expect(sequenceToNumber('42')).toBe(42n)
    expect(compareSequences('9', '10')).toBe(-1)
    expect(compareSequences('10', '10')).toBe(0)
    expect(compareSequences('11', '10')).toBe(1)
  })

  it('increments without float precision loss', () => {
    expect(nextSequence('9007199254740991')).toBe('9007199254740992')
  })

  it('rejects non-decimal sequences', () => {
    expect(() => sequenceToNumber('-1')).toThrow(/invalid event sequence/)
    expect(() => sequenceToNumber('1.5')).toThrow(/invalid event sequence/)
    expect(() => sequenceToNumber('abc')).toThrow(/invalid event sequence/)
  })
})
