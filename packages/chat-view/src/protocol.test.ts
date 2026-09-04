import { describe, expect, it } from 'vitest'
import { parseHostInbound } from './protocol'

describe('chat host protocol', () => {
  it('accepts native string envelopes', () => {
    expect(parseHostInbound('{"type":"reset"}')).toEqual({ type: 'reset' })
  })

  it('accepts browser object envelopes', () => {
    const message = { type: 'setTheme', hue: 210 } as const
    expect(parseHostInbound(message)).toBe(message)
  })

  it('rejects malformed envelopes', () => {
    expect(parseHostInbound('{oops')).toBeNull()
    expect(parseHostInbound(null)).toBeNull()
    expect(parseHostInbound({})).toBeNull()
  })
})
