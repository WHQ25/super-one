import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, setDefaultUsageFetch } from './http'

const preTlsReset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' }) })

afterEach(() => {
  vi.unstubAllGlobals()
  setDefaultUsageFetch((url, init) => fetch(url, init))
})

describe('fetchWithTimeout', () => {
  it('retries once when the connection resets before the request was sent', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(preTlsReset).mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    expect(await (await fetchWithTimeout('https://example.test', {}, 1000)).text()).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses the host default fetch when no impl is passed', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)
    const host = vi.fn(async () => new Response('host'))
    setDefaultUsageFetch(host)
    expect(await (await fetchWithTimeout('https://example.test/codex', { method: 'GET' }, 1000)).text()).toBe('host')
    expect(host).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('uses an injected fetch and leaves the global one alone', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)
    const injected = vi.fn(async () => new Response('via-net'))
    expect(await (await fetchWithTimeout('https://example.test/usage', { method: 'GET' }, 1000, injected)).text()).toBe('via-net')
    expect(injected).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
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
