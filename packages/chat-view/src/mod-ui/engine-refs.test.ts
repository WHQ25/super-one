import { describe, expect, it } from 'vitest'
import type { ModElement } from '@superone/shared/mod-ui'
import { countEngineRefs, firstEngineRef } from './ModTree'

// Recorded: a hook that calls next() twice gets refs 1 and 2, and only ref 1's
// rewritten props cross the wire (Claude contracts, "Only the first engine ref
// carries rewritten props").
const TWO_REFS: ModElement = {
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [{ type: 'engine', ref: 1 }, { type: 'Text', props: {}, children: ['between'] }, { type: 'engine', ref: 2 }],
}

describe('engine refs', () => {
  it('draws the first non-zero ref with the answered props', () => {
    expect(firstEngineRef(TWO_REFS)).toBe(1)
    expect(firstEngineRef({ type: 'engine', ref: 0 })).toBe(0)
  })

  it('counts every engine node, for sites that must draw SuperOne’s own exactly once', () => {
    expect(countEngineRefs(TWO_REFS)).toBe(2)
    expect(countEngineRefs({ type: 'Text', props: {}, children: ['x'] })).toBe(0)
  })
})
