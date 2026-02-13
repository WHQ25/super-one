import { describe, expect, it } from 'vitest'
import { mapModelInfo } from './claude-models'

describe('mapModelInfo', () => {
  it('splits name and description when middle dot exists', () => {
    const mapped = mapModelInfo({
      value: 'claude-opus-4-6',
      displayName: 'Claude Opus 4.6',
      description: 'Opus 4.6 · Most capable model',
    })

    expect(mapped).toEqual({
      id: 'claude-opus-4-6',
      name: 'Opus 4.6',
      description: 'Most capable model',
    })
  })

  it('falls back to displayName when no middle dot exists', () => {
    const mapped = mapModelInfo({
      value: 'claude-sonnet',
      displayName: 'Claude Sonnet',
      description: 'Fast and balanced',
    })

    expect(mapped).toEqual({
      id: 'claude-sonnet',
      name: 'Claude Sonnet',
      description: 'Fast and balanced',
    })
  })

  it('returns empty description string when description is missing', () => {
    const mapped = mapModelInfo({
      value: 'claude-haiku',
      displayName: 'Claude Haiku',
    })

    expect(mapped).toEqual({
      id: 'claude-haiku',
      name: 'Claude Haiku',
      description: '',
    })
  })
})
