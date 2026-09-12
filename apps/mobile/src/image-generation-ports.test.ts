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
    await expect(requestMediaProviderLabels({ request })).resolves.toEqual([
      { id: 'openai', label: 'OpenAI Images', providerLabel: 'OpenAI', models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }] },
    ])
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'list_media_providers' }), expect.any(Number))
  })

  it('answers an empty list when the host errors or is too old to know the command', async () => {
    await expect(requestMediaProviderLabels({ request: vi.fn(async () => ({ error: 'nope' })) })).resolves.toEqual([])
    await expect(requestMediaProviderLabels({ request: vi.fn(async () => null) })).resolves.toEqual([])
  })
})
