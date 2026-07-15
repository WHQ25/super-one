import { describe, it, expect } from 'vitest'
import {
  groupModelsBySlashPrefix,
  resolveClaudeEntries,
  resolveSlashModelLabel,
  splitSlashModelId,
} from './ModelSelectorLists'
import type { ModelOption, ProviderModelEnv } from '@superone/shared/agent-types'

const claudeModels: ModelOption[] = [
  { id: 'claude-opus-4-8', name: 'Opus 4.8', description: 'Top tier' },
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: 'Fast' },
]

describe('resolveClaudeEntries', () => {
  it('with no modelEnv returns models as-is using their own description', () => {
    const entries = resolveClaudeEntries(claudeModels, null)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      model: claudeModels[0],
      displayName: 'Opus 4.8',
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
    const opus = entries.find((e) => e.model.id === 'claude-opus-4-8')
    expect(opus?.displayName).toBe('glm-4.6-air')
    expect(opus?.description).toBeUndefined()
  })

  it('drops the official model.description when modelEnv is set but the bucket is unmapped', () => {
    const env: ProviderModelEnv = {
      sonnet: { id: 'glm-4.6', name: 'GLM 4.6' },
    }
    const entries = resolveClaudeEntries(claudeModels, env)
    const opus = entries.find((e) => e.model.id === 'claude-opus-4-8')
    expect(opus?.displayName).toBe('Opus 4.8')
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

describe('splitSlashModelId / groupModelsBySlashPrefix', () => {
  it('splits provider/model ids', () => {
    expect(splitSlashModelId('openai/gpt-5.4')).toEqual({ group: 'openai', label: 'gpt-5.4' })
    expect(splitSlashModelId('grok-4.5')).toEqual({ group: '', label: 'grok-4.5' })
  })

  it('uses name after slash for display when available', () => {
    expect(resolveSlashModelLabel({
      id: 'openai/gpt-5.4-fast',
      name: 'OpenAI/GPT-5.4 Fast',
      description: '',
    })).toBe('GPT-5.4 Fast')
  })

  it('groups OpenCode-style models by provider prefix', () => {
    const models: ModelOption[] = [
      { id: 'openai/gpt-5.4', name: 'OpenAI/GPT-5.4', description: '' },
      { id: 'openai/gpt-5.4-mini', name: 'OpenAI/GPT-5.4 mini', description: '' },
      { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', description: '' },
      { id: 'google/gemini-3-flash', name: 'Google/Gemini 3 Flash', description: '' },
    ]
    const groups = groupModelsBySlashPrefix(models)
    expect(groups.map((g) => g.group)).toEqual(['openai', 'opencode', 'google'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['GPT-5.4', 'GPT-5.4 mini'])
    expect(groups[1].items[0].label).toBe('Big Pickle')
  })
})

