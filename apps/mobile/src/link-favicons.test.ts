import { describe, expect, it, vi } from 'vitest'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { requestLinkFavicon } from './link-favicons'

const PNG = 'data:image/png;base64,AA=='

describe('requestLinkFavicon', () => {
  it('asks the desktop for the origin icon and returns a data URL', async () => {
    const request = vi.fn(async (_command: RemoteCommand, _timeoutMs?: number) => ({ dataUrl: PNG }))
    await expect(requestLinkFavicon({ request }, 'https://example.com/docs', true)).resolves.toBe(PNG)
    expect(request.mock.calls[0]![0]).toMatchObject({ type: 'resolve_favicon', url: 'https://example.com/docs', isDark: true })
    expect(request.mock.calls[0]![1]).toBe(20_000)
  })

  it('treats a missing or non-image answer as no icon', async () => {
    await expect(requestLinkFavicon({ request: async () => ({ dataUrl: null }) }, 'https://example.com', false)).resolves.toBeNull()
    await expect(requestLinkFavicon({ request: async () => ({ error: 'unknown command' }) }, 'https://example.com', false)).resolves.toBeNull()
    await expect(requestLinkFavicon({ request: async () => ({ dataUrl: 'https://example.com/favicon.ico' }) }, 'https://example.com', false)).resolves.toBeNull()
  })
})
