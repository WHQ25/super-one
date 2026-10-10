import { describe, expect, it, vi } from 'vitest'
import { requestLinkFavicon } from './link-favicons'

const PNG = 'data:image/png;base64,AA=='

describe('requestLinkFavicon', () => {
  it('asks the desktop for the origin icon and returns a data URL', async () => {
    const request = vi.fn(async (_method: string, _payload: unknown, _options?: { timeoutMs?: number }) => ({ dataUrl: PNG }))
    await expect(requestLinkFavicon({ rpc: request }, 'https://example.com/docs', true)).resolves.toBe(PNG)
    expect(request).toHaveBeenCalledWith('environment.favicon', { url: 'https://example.com/docs', isDark: true }, { timeoutMs: 20_000 })
  })

  it('treats a missing or non-image answer as no icon', async () => {
    await expect(requestLinkFavicon({ rpc: async () => ({ dataUrl: null }) }, 'https://example.com', false)).resolves.toBeNull()
    await expect(requestLinkFavicon({ rpc: async () => ({ error: 'unknown command' }) }, 'https://example.com', false)).resolves.toBeNull()
    await expect(requestLinkFavicon({ rpc: async () => ({ dataUrl: 'https://example.com/favicon.ico' }) }, 'https://example.com', false)).resolves.toBeNull()
  })
})
