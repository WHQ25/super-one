import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  explode: false,
  netFetch: vi.fn(async () => new Response('net')),
}))

vi.mock('electron', () => ({
  get net() {
    if (state.explode) throw new Error('No "net" export is defined')
    return { fetch: state.netFetch }
  },
}))

import { desktopNetFetch } from './desktop-net-fetch'

afterEach(() => {
  state.explode = false
  state.netFetch.mockClear()
  vi.unstubAllGlobals()
})

describe('desktopNetFetch', () => {
  it('sends the request through Electron net.fetch', async () => {
    await expect(desktopNetFetch('https://example.test/pins', { method: 'GET' })).resolves.toBeInstanceOf(Response)
    expect(state.netFetch).toHaveBeenCalledWith('https://example.test/pins', { method: 'GET' })
  })

  it('uses global fetch when net is missing', async () => {
    state.explode = true
    const globalFetch = vi.fn(async () => new Response('global'))
    vi.stubGlobal('fetch', globalFetch)
    await expect(desktopNetFetch('https://example.test/pins', { method: 'GET' })).resolves.toBeInstanceOf(Response)
    expect(globalFetch).toHaveBeenCalledWith('https://example.test/pins', { method: 'GET' })
    expect(state.netFetch).not.toHaveBeenCalled()
  })
})
