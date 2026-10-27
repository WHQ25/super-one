import { beforeEach, describe, expect, it, vi } from 'vitest'

const netFetch = vi.hoisted(() => vi.fn(async () => new Response('net')))
const setClaudeUsageFetch = vi.hoisted(() => vi.fn())
const setDefaultUsageFetch = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ net: { fetch: netFetch } }))
vi.mock('@superone/runtime/usage', () => ({ setClaudeUsageFetch, setDefaultUsageFetch }))

import { installClaudeUsageFetch } from './claude-usage-fetch'

beforeEach(() => {
  netFetch.mockClear()
  setClaudeUsageFetch.mockClear()
  setDefaultUsageFetch.mockClear()
})

describe('installClaudeUsageFetch', () => {
  it('sends subscription usage through Electron net.fetch', async () => {
    installClaudeUsageFetch()
    expect(setClaudeUsageFetch).toHaveBeenCalledOnce()
    expect(setDefaultUsageFetch).toHaveBeenCalledOnce()
    expect(setDefaultUsageFetch.mock.calls[0]?.[0]).toBe(setClaudeUsageFetch.mock.calls[0]?.[0])
    const http = setClaudeUsageFetch.mock.calls[0]?.[0] as (url: string, init: RequestInit) => Promise<Response>
    await expect(http('https://api.anthropic.com/api/oauth/usage', { method: 'GET' })).resolves.toBeInstanceOf(Response)
    expect(netFetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', { method: 'GET' })
    installClaudeUsageFetch()
    expect(setClaudeUsageFetch).toHaveBeenCalledOnce()
    expect(setDefaultUsageFetch).toHaveBeenCalledOnce()
  })
})
