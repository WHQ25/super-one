import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestNativeAsync = vi.fn<(action: string, payload?: unknown) => Promise<unknown>>()
vi.mock('./bridge', () => ({ requestNativeAsync: (...args: [string, unknown?]) => requestNativeAsync(...args) }))

const { resolveHostFavicon, resetHostFaviconCache } = await import('./host-favicon')

const PNG = 'data:image/png;base64,AA=='

describe('resolveHostFavicon', () => {
  beforeEach(() => {
    requestNativeAsync.mockReset()
    resetHostFaviconCache()
  })

  it('asks the host once per origin and scheme, not once per link', async () => {
    requestNativeAsync.mockResolvedValue({ dataUrl: PNG })
    await expect(resolveHostFavicon('https://example.com/a', true)).resolves.toBe(PNG)
    await expect(resolveHostFavicon('https://example.com/b?x=1', true)).resolves.toBe(PNG)
    expect(requestNativeAsync).toHaveBeenCalledTimes(1)
    expect(requestNativeAsync).toHaveBeenCalledWith('resolveFavicon', { url: 'https://example.com/a', isDark: true })

    await resolveHostFavicon('https://example.com/a', false)
    expect(requestNativeAsync).toHaveBeenCalledTimes(2)
    expect(requestNativeAsync).toHaveBeenLastCalledWith('resolveFavicon', { url: 'https://example.com/a', isDark: false })
  })

  it('never asks for a link that is not http(s)', async () => {
    await expect(resolveHostFavicon('mailto:a@b.c', true)).resolves.toBeNull()
    await expect(resolveHostFavicon('not a url', true)).resolves.toBeNull()
    expect(requestNativeAsync).not.toHaveBeenCalled()
  })

  it('treats a host that cannot answer as "no icon" and remembers it', async () => {
    requestNativeAsync.mockRejectedValue(new Error('Request timed out'))
    await expect(resolveHostFavicon('https://old.host/', true)).resolves.toBeNull()
    await expect(resolveHostFavicon('https://old.host/page', true)).resolves.toBeNull()
    expect(requestNativeAsync).toHaveBeenCalledTimes(1)
  })

  it('rejects an answer that is not image bytes', async () => {
    requestNativeAsync.mockResolvedValue({ dataUrl: 'https://example.com/favicon.ico' })
    await expect(resolveHostFavicon('https://example.com/', false)).resolves.toBeNull()
    requestNativeAsync.mockResolvedValue({ error: 'boom' })
    await expect(resolveHostFavicon('https://other.example/', false)).resolves.toBeNull()
  })
})
