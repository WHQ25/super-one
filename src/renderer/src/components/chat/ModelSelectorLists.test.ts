import { describe, it, expect } from 'vitest'
import { resolveClaudeEntries } from './ModelSelectorLists'
import type { ModelOption, ProviderModelEnv } from '../../../../shared/agent-types'

const claudeModels: ModelOption[] = [
  { id: 'claude-opus-4-7', name: 'Opus 4.7', description: 'Top tier' },
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: 'Fast' },
]

describe('resolveClaudeEntries', () => {
  it('with no modelEnv returns models as-is using their own description', () => {
    const entries = resolveClaudeEntries(claudeModels, null)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      model: claudeModels[0],
      displayName: 'Opus 4.7',
      description: 'Top tier',
    })
    expect(entries[1].displayName).toBe('Sonnet 4.5')
    expect(entries[2].description).toBe('Fast')
  })

  it('replaces displayName with mapped slot.name when bucket is mapped', () => {
    const env: ProviderModelEnv = {
      sonnet: { id: 'glm-4.6', name: 'GLM 4.6', description: 'Zhipu' },
    }
    const entries = resolveClaudeEntries(claudeModels, env)
    const sonnet = entries.find((e) => e.model.id === 'claude-sonnet-4-5')
    expect(sonnet?.displayName).toBe('GLM 4.6')
    expect(sonnet?.description).toBe('Zhipu')
  })

  it('falls back to slot.id when slot has no name', () => {
    const env: ProviderModelEnv = {
      opus: { id: 'glm-4.6-air' },
    }
    const entries = resolveClaudeEntries(claudeModels, env)
    const opus = entries.find((e) => e.model.id === 'claude-opus-4-7')
    expect(opus?.displayName).toBe('glm-4.6-air')
    expect(opus?.description).toBeUndefined()
  })

  it('drops the official model.description when modelEnv is set but the bucket is unmapped', () => {
    const env: ProviderModelEnv = {
      sonnet: { id: 'glm-4.6', name: 'GLM 4.6' },
    }
    const entries = resolveClaudeEntries(claudeModels, env)
    const opus = entries.find((e) => e.model.id === 'claude-opus-4-7')
    expect(opus?.displayName).toBe('Opus 4.7')
    expect(opus?.description).toBeUndefined()
  })

  it('deduplicates rows that map to the same slot.id', () => {
    const env: ProviderModelEnv = {
      sonnet: { id: 'shared-model', name: 'Shared' },
      haiku: { id: 'shared-model', name: 'Shared' },
    }
    const entries = resolveClaudeEntries(claudeModels, env)
    expect(entries.filter((e) => e.displayName === 'Shared')).toHaveLength(1)
  })
})
