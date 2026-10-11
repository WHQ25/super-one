import { beforeEach, describe, expect, it, vi } from 'vitest'
import { answeredLinkFavicon, cachedLinkFavicon, linkOrigin, requestLinkFavicon, resetLinkFaviconCacheForTests } from './link-favicons'

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

describe('cachedLinkFavicon', () => {
  beforeEach(resetLinkFaviconCacheForTests)

  it('asks once per origin and scheme, sharing the request in flight', async () => {
    const resolve = vi.fn(async () => PNG)
    await Promise.all([cachedLinkFavicon('https://example.com/a', false, resolve), cachedLinkFavicon('https://EXAMPLE.com/b', false, resolve)])
    await expect(cachedLinkFavicon('https://example.com/c', false, resolve)).resolves.toBe(PNG)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(answeredLinkFavicon('https://example.com/zzz', false)).toBe(PNG)
    expect(answeredLinkFavicon('https://example.com', true)).toBeUndefined()
    await cachedLinkFavicon('https://example.com', true, resolve)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('remembers a missing icon but retries a failed request', async () => {
    const missing = vi.fn(async () => null)
    await cachedLinkFavicon('https://none.dev', false, missing)
    await cachedLinkFavicon('https://none.dev/x', false, missing)
    expect(missing).toHaveBeenCalledTimes(1)
    expect(answeredLinkFavicon('https://none.dev', false)).toBeNull()

    const offline = vi.fn(async (): Promise<string | null> => { throw new Error('not connected') })
    await expect(cachedLinkFavicon('https://later.dev', false, offline)).rejects.toThrow('not connected')
    expect(answeredLinkFavicon('https://later.dev', false)).toBeUndefined()
    await expect(cachedLinkFavicon('https://later.dev', false, async () => PNG)).resolves.toBe(PNG)
  })
})

describe('linkOrigin', () => {
  it('reads scheme and host, lowercased, without credentials', () => {
    expect(linkOrigin('HTTPS://user:pw@Example.com:8443/path?q')).toBe('https://example.com:8443')
    expect(linkOrigin('ftp://example.com')).toBeNull()
  })
})
