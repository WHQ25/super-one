import { describe, expect, it, vi } from 'vitest'
import { requestMediaProviderLabels } from './image-generation-ports'

describe('media provider labels over the relay', () => {
  it('asks the host once and keeps only well-formed entries', async () => {
    const request = vi.fn(async () => ({
      providers: [
        { id: 'openai', label: 'OpenAI Images', providerLabel: 'OpenAI', models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }] },
        { id: 'broken' },
        'junk',
      ],
    }))
    await expect(requestMediaProviderLabels({ rpc: request })).resolves.toEqual([
      { id: 'openai', label: 'OpenAI Images', providerLabel: 'OpenAI', models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }] },
    ])
    expect(request).toHaveBeenCalledWith('media.listProviders', {}, { timeoutMs: 15_000 })
  })

  it('answers an empty list when the host errors or is too old to know the command', async () => {
    await expect(requestMediaProviderLabels({ rpc: vi.fn(async () => ({ error: 'nope' })) })).resolves.toEqual([])
    await expect(requestMediaProviderLabels({ rpc: vi.fn(async () => null) })).resolves.toEqual([])
  })
})
