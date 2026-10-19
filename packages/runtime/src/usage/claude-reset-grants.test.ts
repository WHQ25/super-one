import { describe, expect, it } from 'vitest'
import { parseClaudeResetGrants } from './claude'

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

describe('parseClaudeResetGrants (cedar_ember → usable reset grants)', () => {
  it('keeps grants with resets left, with their deadline, and skips spent ones', () => {
    const grants = parseClaudeResetGrants({ cedar_ember: { eligible: true, grants: [
      { id: 'launch', resets_left: 1, ends_at: '2026-10-22T16:00:00+00:00' },
      { id: 'other', resets_left: 2 },
      { id: 'spent', resets_left: 0, ends_at: '2026-10-05T00:00:00+00:00' },
    ] } })

    expect(grants).toEqual([
      { resetsLeft: 1, expiresAt: epoch('2026-10-22T16:00:00Z') },
      { resetsLeft: 2, expiresAt: null },
    ])
  })

  it('reads no grants outside the program or when the account is not eligible', () => {
    expect(parseClaudeResetGrants({})).toEqual([])
    expect(parseClaudeResetGrants({ cedar_ember: null })).toEqual([])
    expect(parseClaudeResetGrants({ cedar_ember: { eligible: false, grants: [{ id: 'g', resets_left: 1 }] } })).toEqual([])
  })

  it('voids the whole block when any grant is malformed', () => {
    expect(parseClaudeResetGrants({ cedar_ember: { eligible: true, grants: [{ id: 'ok', resets_left: 1 }, { id: '', resets_left: 1 }] } })).toEqual([])
    expect(parseClaudeResetGrants({ cedar_ember: { eligible: true, grants: [{ id: 'g' }] } })).toEqual([])
  })
})
