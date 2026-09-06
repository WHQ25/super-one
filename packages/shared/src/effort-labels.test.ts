import { describe, expect, it } from 'vitest'
import {
  compactEffortLabel,
  formatEffortLabel,
  isKnownEffortLevel,
  sortEffortsAscending,
} from './effort-labels'

describe('formatEffortLabel', () => {
  it('spells every known level the way the desktop selectors do', () => {
    expect(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(formatEffortLabel))
      .toEqual(['Minimal', 'Low', 'Medium', 'High', 'Extra High', 'Max', 'Ultra'])
  })

  it('title-cases an unknown agent-supplied id', () => {
    expect(formatEffortLabel('deep-think')).toBe('Deep Think')
  })
})

describe('compactEffortLabel', () => {
  it('drops the noun the surrounding UI already shows', () => {
    expect(compactEffortLabel('High Effort')).toBe('High')
    expect(compactEffortLabel('Fast')).toBe('Fast')
  })

  it('keeps a name that is only the word Effort', () => {
    expect(compactEffortLabel('Effort')).toBe('Effort')
  })
})

describe('sortEffortsAscending', () => {
  it('turns an agent high→low catalog into a left→right slider order', () => {
    const sorted = sortEffortsAscending([
      { value: 'high', label: 'High Effort' },
      { value: 'low', label: 'Low Effort' },
      { value: 'medium', label: 'Medium Effort' },
    ])

    expect(sorted.map((option) => option.value)).toEqual(['low', 'medium', 'high'])
  })

  it('ranks by the name when the id is opaque, and parks the rest at the end in order', () => {
    const sorted = sortEffortsAscending([
      { value: 'cfg-2', label: 'High Effort' },
      { value: 'custom-b', label: 'Custom B' },
      { value: 'cfg-1', label: 'Low Effort' },
      { value: 'custom-a', label: 'Custom A' },
    ])

    expect(sorted.map((option) => option.value)).toEqual(['cfg-1', 'cfg-2', 'custom-b', 'custom-a'])
  })
})

describe('isKnownEffortLevel', () => {
  it('accepts the levels the ACP backend can actually apply', () => {
    expect(isKnownEffortLevel('xhigh')).toBe(true)
    expect(isKnownEffortLevel('code')).toBe(false)
  })
})
