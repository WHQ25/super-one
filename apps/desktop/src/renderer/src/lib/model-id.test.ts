import { describe, expect, it } from 'vitest'
import { collectOneMillionIds, hasOneM, stripOneM } from './model-id'

describe('stripOneM / hasOneM', () => {
  it('strips and detects the [1m] suffix', () => {
    expect(hasOneM('k3[1m]')).toBe(true)
    expect(stripOneM('k3[1m]')).toBe('k3')
    expect(hasOneM('k3')).toBe(false)
    expect(stripOneM('k3')).toBe('k3')
  })
})

describe('collectOneMillionIds', () => {
  it('includes catalog models with contextWindow >= 1M', () => {
    const ids = collectOneMillionIds(
      [
        { id: 'kimi-k3', contextWindow: 1_000_000 },
        { id: 'kimi-k2.6', contextWindow: 256_000 },
      ],
      [],
    )
    expect(ids.has('kimi-k3')).toBe(true)
    expect(ids.has('kimi-k2.6')).toBe(false)
  })

  it('includes base ids from plan presets that ship with [1m] (coding-plan aliases)', () => {
    const ids = collectOneMillionIds(
      [{ id: 'kimi-k3', contextWindow: 1_000_000 }],
      [
        {
          default: { id: 'k3[1m]' },
          opus: { id: 'k3[1m]' },
          haiku: { id: 'kimi-for-coding' },
        },
      ],
    )
    expect(ids.has('kimi-k3')).toBe(true)
    expect(ids.has('k3')).toBe(true)
    expect(ids.has('kimi-for-coding')).toBe(false)
  })

  it('ignores null/empty mappings', () => {
    const ids = collectOneMillionIds([], [null, undefined, {}])
    expect(ids.size).toBe(0)
  })
})
