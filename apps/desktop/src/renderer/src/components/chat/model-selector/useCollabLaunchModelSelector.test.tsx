import { describe, expect, it } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'
import {
  claudeModelsForProvider,
  codexModelsToSelectorOptions,
  compactEffortLabel,
  flatHarnessCatalog,
  formatClaudeStyleEffortLabel,
  mergeCollabProviders,
} from './useCollabLaunchModelSelector'

describe('mergeCollabProviders', () => {
  it('always leads with Default and merges live keys over profile entries', () => {
    const providers = mergeCollabProviders({
      harnessId: 'claude',
      profileProviders: [
        { id: 'stale', name: 'Stale Name', brand: 'openai', keyName: 'old' },
        { id: 'profile-only', name: 'Profile Only', keyName: 'p' },
      ],
      live: [
        { id: 'stale', name: 'Fresh Name', brand: 'openai', keyName: 'new' },
        { id: 'live-only', name: 'Live Only', brand: 'deepseek', keyName: 'l' },
      ],
      defaultLabel: 'Claude Code (Official)',
    })

    expect(providers[0]).toEqual({ id: null, brand: 'claude', name: 'Claude Code (Official)' })
    expect(providers.find((p) => p.id === 'stale')).toEqual({
      id: 'stale',
      name: 'Fresh Name',
      brand: 'openai',
      keyName: 'new',
    })
    expect(providers.find((p) => p.id === 'profile-only')).toMatchObject({ id: 'profile-only' })
    expect(providers.find((p) => p.id === 'live-only')).toMatchObject({ id: 'live-only' })
  })
})

describe('claudeModelsForProvider', () => {
  const catalog: ModelOption[] = [
    { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { id: 'claude-opus-4-5', name: 'Opus 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  ]

  it('keeps catalog labels when no model mapping is active', () => {
    expect(claudeModelsForProvider(catalog, null)).toEqual([
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
      { id: 'claude-opus-4-5', name: 'Opus 4.5' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
    ])
  })

  it('remaps Claude slots to third-party model names like the chat selector', () => {
    const mapped = claudeModelsForProvider(catalog, {
      sonnet: { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      opus: { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      haiku: { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    })
    // Identical mapped ids collapse to one entry (same as main chat selector).
    expect(mapped).toEqual([
      { id: 'claude-sonnet-4-5', name: 'DeepSeek Chat' },
      { id: 'claude-opus-4-5', name: 'DeepSeek Reasoner' },
    ])
  })
})

describe('codexModelsToSelectorOptions', () => {
  it('formats codex model ids like the chat selector', () => {
    expect(codexModelsToSelectorOptions([
      { id: 'gpt-5.4', name: 'gpt-5.4', description: '' },
      { id: 'custom-model', name: 'My Custom', description: 'x' },
    ])).toEqual([
      { id: 'gpt-5.4', name: 'GPT5.4' },
      { id: 'custom-model', name: 'My Custom', description: 'x' },
    ])
  })
})

describe('flatHarnessCatalog', () => {
  const cursorResources = {
    models: [
      { id: 'composer-1', name: 'Composer 1', description: '' },
      { id: 'retired', name: 'Retired', description: '' },
    ],
    disabledModelIds: ['retired'],
  }
  const profileCatalog: ModelOption[] = [{ id: 'from-profile', name: 'From Profile', description: '' }]

  it('offers the live Cursor catalog minus models disabled in harness config', () => {
    expect(flatHarnessCatalog({
      harnessId: 'cursor',
      cursorResources,
      dshModels: [],
      profileCatalog,
    }).map((model) => model.id)).toEqual(['composer-1'])
  })

  it('falls back to the profile catalog before the live Cursor cache arrives', () => {
    expect(flatHarnessCatalog({
      harnessId: 'cursor',
      cursorResources: null,
      dshModels: [],
      profileCatalog,
    })).toEqual(profileCatalog)
  })

  it('serves dsh from its own catalog and leaves other harnesses to their own path', () => {
    const dshModels: ModelOption[] = [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '' }]
    expect(flatHarnessCatalog({ harnessId: 'dsh', cursorResources: null, dshModels, profileCatalog }))
      .toEqual(dshModels)
    expect(flatHarnessCatalog({ harnessId: 'claude', cursorResources, dshModels, profileCatalog }))
      .toEqual([])
  })
})

describe('effort labels', () => {
  it('matches Claude chat effort labels including Extra High and Max', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(formatClaudeStyleEffortLabel))
      .toEqual(['Low', 'Medium', 'High', 'Extra High', 'Max'])
    expect(formatClaudeStyleEffortLabel('xhigh')).toBe('Extra High')
    expect(formatClaudeStyleEffortLabel('max')).toBe('Max')
    expect(formatClaudeStyleEffortLabel('high')).toBe('High')
  })

  it('compacts ACP effort names the same way as AcpModelSelector', () => {
    expect(compactEffortLabel('High Effort')).toBe('High')
    expect(compactEffortLabel('Extra High Effort')).toBe('Extra High')
    expect(formatClaudeStyleEffortLabel('High Effort')).toBe('High')
  })
})
