import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '@superone/shared/model-catalog-types'
import {
  buildUsageModelNameIndex,
  resolveUsageModelPresentation,
  usageModelId,
} from './usage-model-presentation'

const opus: CatalogModel = {
  id: 'claude-opus-4-6',
  name: 'Claude Opus 4.6',
  providerId: 'anthropic',
  inputModalities: ['text'],
  outputModalities: ['text'],
  reasoning: true,
  toolCall: true,
  attachment: true,
}

const catalogModels = new Map([[opus.id, opus]])

describe('resolveUsageModelPresentation', () => {
  it('uses the AI Provider catalog display name and provider brand', () => {
    expect(resolveUsageModelPresentation(opus.id, 'claude', catalogModels)).toEqual({
      displayName: 'Claude Opus 4.6',
      providerBrand: 'anthropic',
    })
  })

  it('matches provider-prefixed and extended-context model ids', () => {
    expect(resolveUsageModelPresentation('relay/claude-opus-4-6[1m]', 'claude', catalogModels).displayName)
      .toBe('Claude Opus 4.6')
  })

  it('treats the 1m context marker as separate from the model id', () => {
    expect(usageModelId('claude-opus-4-6[1m]')).toBe('claude-opus-4-6')
    expect(resolveUsageModelPresentation('custom-model[1m]', 'claude', catalogModels).displayName)
      .toBe('custom-model')
  })

  it('falls back to the raw id and harness provider for unknown models', () => {
    expect(resolveUsageModelPresentation('custom-model', 'codex', catalogModels)).toEqual({
      displayName: 'custom-model',
      providerBrand: 'openai',
    })
  })

  it('uses a provider-discovered display name when the catalog has no model', () => {
    const knownNames = buildUsageModelNameIndex([
      { id: 'grok-4.5', name: 'Grok 4.5' },
    ])
    expect(resolveUsageModelPresentation('grok-4.5', 'grok', catalogModels, knownNames)).toEqual({
      displayName: 'Grok 4.5',
      providerBrand: 'xai',
    })
  })
})
