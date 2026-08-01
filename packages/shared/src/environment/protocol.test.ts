import { describe, expect, it } from 'vitest'
import {
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  isValidProtocolRange,
  negotiateHandshake,
  rangesOverlap,
  type HandshakeGenerations,
  type ProtocolRange,
} from './protocol'

const currentLocal: HandshakeGenerations = {
  protocol: { ...PROTOCOL_GENERATION },
  databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
}

describe('rangesOverlap', () => {
  it('returns true when ranges fully overlap', () => {
    expect(rangesOverlap({ min: 1, max: 3, current: 2 }, { min: 2, max: 4, current: 3 })).toBe(true)
  })

  it('returns true when ranges touch at a boundary', () => {
    expect(rangesOverlap({ min: 1, max: 2, current: 2 }, { min: 2, max: 3, current: 2 })).toBe(true)
  })

  it('returns false when ranges are disjoint', () => {
    expect(rangesOverlap({ min: 1, max: 1, current: 1 }, { min: 2, max: 3, current: 2 })).toBe(false)
  })
})

describe('negotiateHandshake', () => {
  it('accepts identical current generations', () => {
    const result = negotiateHandshake(currentLocal, currentLocal)
    expect(result).toEqual({ ok: true, protocol: 1, databaseSchema: 1 })
  })

  it('blocks when protocol ranges do not overlap', () => {
    const remote: HandshakeGenerations = {
      protocol: { current: 3, min: 2, max: 3 },
      databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    }
    const result = negotiateHandshake(currentLocal, remote)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('protocol generation mismatch')
    }
  })

  it('blocks when database schema ranges do not overlap', () => {
    const remote: HandshakeGenerations = {
      protocol: { ...PROTOCOL_GENERATION },
      databaseSchema: { current: 5, min: 4, max: 5 },
    }
    const result = negotiateHandshake(currentLocal, remote)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('database schema generation mismatch')
    }
  })

  it('picks the highest mutually supported generation', () => {
    const local: HandshakeGenerations = {
      protocol: { current: 2, min: 1, max: 2 },
      databaseSchema: { current: 2, min: 1, max: 2 },
    }
    const remote: HandshakeGenerations = {
      protocol: { current: 3, min: 2, max: 3 },
      databaseSchema: { current: 1, min: 1, max: 1 },
    }
    const result = negotiateHandshake(local, remote)
    expect(result).toEqual({ ok: true, protocol: 2, databaseSchema: 1 })
  })

  it('rejects partial ranges missing current', () => {
    const remote = {
      protocol: { min: 1, max: 1 },
      databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    } as HandshakeGenerations
    const result = negotiateHandshake(currentLocal, remote)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('valid protocol')
  })

  it('rejects ranges where current is outside [min, max]', () => {
    const remote: HandshakeGenerations = {
      protocol: { current: 5, min: 1, max: 2 },
      databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    }
    const result = negotiateHandshake(currentLocal, remote)
    expect(result.ok).toBe(false)
  })
})

describe('isValidProtocolRange', () => {
  it('accepts well-formed ranges', () => {
    expect(isValidProtocolRange({ current: 1, min: 1, max: 1 })).toBe(true)
  })

  it('rejects non-integers and inverted bounds', () => {
    expect(isValidProtocolRange({ current: 1.5, min: 1, max: 2 })).toBe(false)
    expect(isValidProtocolRange({ current: 1, min: 2, max: 1 })).toBe(false)
    expect(isValidProtocolRange(null)).toBe(false)
    expect(isValidProtocolRange({ min: 1, max: 1 })).toBe(false)
  })
})

describe('PROTOCOL_GENERATION constants', () => {
  it('keeps current within [min, max]', () => {
    const assertRange = (r: ProtocolRange) => {
      expect(r.current).toBeGreaterThanOrEqual(r.min)
      expect(r.current).toBeLessThanOrEqual(r.max)
      expect(r.min).toBeLessThanOrEqual(r.max)
    }
    assertRange(PROTOCOL_GENERATION)
    assertRange(DATABASE_SCHEMA_GENERATION)
  })
})
