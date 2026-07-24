import { describe, expect, it } from 'vitest'
import type { ProviderListResponse } from '@opencode-ai/sdk/v2'
import { parseModels, parseOpenCodeModelSlug } from './opencode-client'

describe('opencode-client', () => {
  it('parses model slugs at the first separator', () => {
    expect(parseOpenCodeModelSlug('openrouter/anthropic/claude-sonnet')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-sonnet',
    })
    expect(parseOpenCodeModelSlug('missing-separator')).toBeNull()
    expect(parseOpenCodeModelSlug('/missing-provider')).toBeNull()
  })

  it('returns connected models with SDK variants and defaults', () => {
    const payload = {
      connected: ['openai'],
      default: { openai: 'gpt-5', anthropic: 'claude' },
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, turbo: {} },
            },
          },
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            claude: {
              id: 'claude',
              name: 'Claude',
              capabilities: { reasoning: true },
              variants: { high: {} },
            },
          },
        },
      ],
    } as unknown as ProviderListResponse

    expect(parseModels(payload)).toEqual([
      {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        description: 'OpenAI reasoning model',
        isDefault: true,
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium'],
      },
    ])
  })
})
