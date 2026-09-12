import { describe, expect, it } from 'vitest'
import type { MediaProviderLabel } from './agent-types'
import { resolveMediaModelLabel, resolveMediaProviderLabel } from './media-provider-labels'

const PROVIDERS: MediaProviderLabel[] = [
  { id: 'openai', label: 'OpenAI Images', providerLabel: 'OpenAI', models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }] },
  { id: 'volcengine', label: 'Volcengine', models: [{ id: 'gpt-image-1', label: 'GPT Image 1 (mirror)' }, { id: 'seedream', label: 'Seedream' }] },
]

describe('media provider labels', () => {
  it('names a vendor with its product as a badge, and a plain provider by its label alone', () => {
    expect(resolveMediaProviderLabel('openai', PROVIDERS)).toEqual({ name: 'OpenAI', badge: 'OpenAI Images' })
    expect(resolveMediaProviderLabel('volcengine', PROVIDERS)).toEqual({ name: 'Volcengine' })
    expect(resolveMediaProviderLabel('gone', PROVIDERS)).toEqual({ name: 'gone' })
  })

  it('resolves a model through the image\'s own provider before any other', () => {
    expect(resolveMediaModelLabel('gpt-image-1', 'volcengine', PROVIDERS)).toBe('GPT Image 1 (mirror)')
    expect(resolveMediaModelLabel('gpt-image-1', 'openai', PROVIDERS)).toBe('GPT Image 1')
    expect(resolveMediaModelLabel('seedream', undefined, PROVIDERS)).toBe('Seedream')
    expect(resolveMediaModelLabel('unknown', 'openai', PROVIDERS)).toBe('unknown')
  })
})
