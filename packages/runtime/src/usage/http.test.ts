import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from './http'

const preTlsReset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' }) })

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchWithTimeout', () => {
  it('retries once when the connection resets before the request was sent', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(preTlsReset).mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    expect(await (await fetchWithTimeout('https://example.test', {}, 1000)).text()).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry other failures or a second reset', async () => {
    const other = vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }))
    vi.stubGlobal('fetch', other)
    await expect(fetchWithTimeout('https://example.test', {}, 1000)).rejects.toThrow('fetch failed')
    expect(other).toHaveBeenCalledTimes(1)
    const resets = vi.fn().mockRejectedValue(preTlsReset)
    vi.stubGlobal('fetch', resets)
    await expect(fetchWithTimeout('https://example.test', {}, 1000)).rejects.toBe(preTlsReset)
    expect(resets).toHaveBeenCalledTimes(2)
  })
})
