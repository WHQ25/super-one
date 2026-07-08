import { describe, expect, it } from 'vitest'
import { mergeEndpoint, mergeExtraEnv, mergeModelMapping } from './merge'

describe('mergeExtraEnv', () => {
  it('merges by key with later layers winning', () => {
    expect(mergeExtraEnv({ A: '1', B: '2' }, { B: '3', C: '4' })).toEqual({ A: '1', B: '3', C: '4' })
  })

  it('ignores undefined layers', () => {
    expect(mergeExtraEnv(undefined, { A: '1' }, undefined)).toEqual({ A: '1' })
  })
})

describe('mergeModelMapping', () => {
  it('merges slot-by-slot, later layer wins per slot only', () => {
    const base = { opus: { id: 'a' }, sonnet: { id: 'b' }, haiku: { id: 'c' } }
    const over = { sonnet: { id: 'b2' } }
    expect(mergeModelMapping(base, over)).toEqual({
      opus: { id: 'a' },
      sonnet: { id: 'b2' },
      haiku: { id: 'c' },
    })
  })

  it('skips slots without an id', () => {
    expect(mergeModelMapping({ opus: { id: 'a' } }, { opus: undefined })).toEqual({ opus: { id: 'a' } })
  })
})

describe('mergeEndpoint', () => {
  const endpoint = {
    baseUrl: 'https://base',
    models: [{ id: 'm1' }],
    defaults: { extraEnv: { A: '1' }, modelMapping: { opus: { id: 'o' } } },
  }

  it('replaces baseUrl and models wholesale from override', () => {
    const merged = mergeEndpoint(endpoint, { baseUrl: 'https://override', models: [{ id: 'm2' }] })
    expect(merged.baseUrl).toBe('https://override')
    expect(merged.models).toEqual([{ id: 'm2' }])
  })

  it('key-merges extraEnv (user wins) and slot-merges modelMapping across three layers', () => {
    const merged = mergeEndpoint(
      endpoint,
      { extraEnv: { A: '2', B: '3' }, modelMapping: { sonnet: { id: 's' } } },
      { modelMapping: { opus: { id: 'o2' } } },
    )
    expect(merged.extraEnv).toEqual({ A: '2', B: '3' })
    expect(merged.modelMapping).toEqual({ opus: { id: 'o2' }, sonnet: { id: 's' } })
  })

  it('falls back to endpoint defaults when no override given', () => {
    const merged = mergeEndpoint(endpoint)
    expect(merged.baseUrl).toBe('https://base')
    expect(merged.models).toEqual([{ id: 'm1' }])
    expect(merged.extraEnv).toEqual({ A: '1' })
    expect(merged.modelMapping).toEqual({ opus: { id: 'o' } })
  })
})
