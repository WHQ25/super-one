import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { mapModelInfo } from './claude-models'

describe('mapModelInfo', () => {
  it('extracts concise name from "with context" description (Max default)', () => {
    const mapped = mapModelInfo({
      value: 'default',
      displayName: 'Default (recommended)',
      description: 'Opus 4.6 with 1M context [NEW] · Most capable for complex work',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    })

    expect(mapped).toMatchObject({
      id: 'default',
      name: 'Opus 4.6 1M',
      description: 'Opus 4.6 with 1M context [NEW] · Most capable for complex work',
      supportsEffort: true,
    })
  })

  it('extracts simple name from description (Pro default)', () => {
    const mapped = mapModelInfo({
      value: 'default',
      displayName: 'Default (recommended)',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    })

    expect(mapped).toMatchObject({
      id: 'default',
      name: 'Sonnet 4.6',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    })
  })

  it('extracts name for standalone model (Pro opus)', () => {
    const mapped = mapModelInfo({
      value: 'opus',
      displayName: 'Opus',
      description: 'Opus 4.6 · Most capable for complex work',
    })

    expect(mapped).toMatchObject({
      id: 'opus',
      name: 'Opus 4.6',
      description: 'Opus 4.6 · Most capable for complex work',
    })
  })

  it('extracts name with context suffix (Max sonnet[1m])', () => {
    const mapped = mapModelInfo({
      value: 'sonnet[1m]',
      displayName: 'Sonnet (1M context)',
      description: 'Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15 per Mtok',
    })

    expect(mapped).toMatchObject({
      id: 'sonnet[1m]',
      name: 'Sonnet 4.6 1M',
      description: 'Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15 per Mtok',
    })
  })

  it('falls back to displayName when no middle dot exists', () => {
    const mapped = mapModelInfo({
      value: 'sonnet',
      displayName: 'Sonnet',
      description: 'Fast and balanced',
    })

    expect(mapped).toMatchObject({
      id: 'sonnet',
      name: 'Sonnet',
      description: 'Fast and balanced',
    })
  })

  it('falls back to displayName when description is missing', () => {
    const mapped = mapModelInfo({
      value: 'haiku',
      displayName: 'Haiku',
    })

    expect(mapped).toMatchObject({
      id: 'haiku',
      name: 'Haiku',
      description: '',
    })
  })

  it('falls back to displayName when description prefix does not match pattern', () => {
    const mapped = mapModelInfo({
      value: 'custom',
      displayName: 'Custom Model',
      description: 'some unexpected format · details here',
    })

    expect(mapped).toMatchObject({
      id: 'custom',
      name: 'Custom Model',
      description: 'some unexpected format · details here',
    })
  })

  it('passes supportsAutoMode through when the SDK reports it', () => {
    const mapped = mapModelInfo({
      value: 'default',
      displayName: 'Default (recommended)',
      description: 'Opus 4.8 with 1M context · Most capable for complex work',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
      supportsAutoMode: true,
    })

    expect(mapped.supportsAutoMode).toBe(true)
  })

  it('omits supportsAutoMode when the SDK does not report it (plan-filtered absence)', () => {
    const mapped = mapModelInfo({
      value: 'sonnet',
      displayName: 'Sonnet',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    })

    expect(mapped.supportsAutoMode).toBeUndefined()
  })
})
