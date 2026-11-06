import { describe, expect, it } from 'vitest'
import { truncateUtf8 } from './subagent-diagnostic'

describe('truncateUtf8', () => {
  it('measures bytes, not UTF-16 units, and never splits a character', () => {
    // Each of these is 3 UTF-8 bytes, so 4 of them exceed a 10-byte budget and
    // the cut lands mid-character — the case a `.slice()` by length gets wrong.
    const cut = truncateUtf8('宽宽宽宽', 10)
    expect(cut).toBe('宽宽宽')
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(10)
  })

  it('leaves text that already fits exactly as it was', () => {
    expect(truncateUtf8('short', 4096)).toBe('short')
  })
})
