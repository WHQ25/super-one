import { describe, expect, it, vi } from 'vitest'
import {
  checkLanReachable,
  checkRelayDesktopOnline,
  parseLanHostPort,
  roomIdForSecret,
} from './presence'

const SECRET = 'a'.repeat(64)

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }))
}

describe('relay desktop presence', () => {
  it('reports online when the relay says a desktop holds the room', async () => {
    const fetch = respond({ desktop: true })
    const online = await checkRelayDesktopOnline({
      relayUrl: 'wss://relay.example.com',
      masterSecret: SECRET,
      fetch,
      now: () => 1_700_000_000_000,
    })
    expect(online).toBe(true)
    const [url] = fetch.mock.calls[0]
    expect(url).toBe(
      `https://relay.example.com/status?room=${roomIdForSecret(SECRET)}&ts=1700000000000`,
    )
  })

  it('reports offline when the room exists but no desktop is attached', async () => {
    const online = await checkRelayDesktopOnline({
      relayUrl: 'wss://relay.example.com',
      masterSecret: SECRET,
      fetch: respond({ desktop: false }),
    })
    expect(online).toBe(false)
  })

  it('treats a non-200 status and a network failure alike as offline', async () => {
    const rejected = await checkRelayDesktopOnline({
      relayUrl: 'wss://relay.example.com',
      masterSecret: SECRET,
      fetch: respond({ desktop: true }, { ok: false, status: 401 }),
    })
    const thrown = await checkRelayDesktopOnline({
      relayUrl: 'wss://relay.example.com',
      masterSecret: SECRET,
      fetch: async () => { throw new Error('offline') },
    })
    expect([rejected, thrown]).toEqual([false, false])
  })

  it('downgrades an insecure ws relay to http rather than rejecting it', async () => {
    const fetch = respond({ desktop: true })
    await checkRelayDesktopOnline({
      relayUrl: 'ws://192.168.1.9:8787/',
      masterSecret: SECRET,
      fetch,
      now: () => 42,
    })
    expect(fetch.mock.calls[0][0]).toMatch(/^http:\/\/192\.168\.1\.9:8787\/status\?/)
  })

  it('rejects a relay URL that is not a WebSocket URL', async () => {
    await expect(checkRelayDesktopOnline({
      relayUrl: 'https://relay.example.com',
      masterSecret: SECRET,
      fetch: respond({ desktop: true }),
    })).rejects.toThrow(/rejected/)
  })

  it('aborts the request once the timeout elapses', async () => {
    vi.useFakeTimers()
    try {
      let aborted = false
      const promise = checkRelayDesktopOnline({
        relayUrl: 'wss://relay.example.com',
        masterSecret: SECRET,
        timeoutMs: 5_000,
        fetch: (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        }),
      })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await promise).toBe(false)
      expect(aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LAN reachability', () => {
  it('counts the LAN server 426 Upgrade Required as reachable', async () => {
    const fetch = respond('Upgrade required', { ok: false, status: 426 })
    expect(await checkLanReachable({ host: '192.168.1.9', port: 8123, fetch })).toBe(true)
    expect(fetch.mock.calls[0][0]).toBe('http://192.168.1.9:8123/')
  })

  it('counts a refused connection as unreachable', async () => {
    const reachable = await checkLanReachable({
      host: '192.168.1.9',
      port: 8123,
      fetch: async () => { throw new Error('ECONNREFUSED') },
    })
    expect(reachable).toBe(false)
  })

  it('brackets a bare IPv6 host', async () => {
    const fetch = respond('', { ok: false, status: 426 })
    await checkLanReachable({ host: 'fe80::1', port: 8123, fetch })
    expect(fetch.mock.calls[0][0]).toBe('http://[fe80::1]:8123/')
  })
})

describe('stored LAN address', () => {
  it('parses a host:port pair', () => {
    expect(parseLanHostPort('192.168.1.9:8123')).toEqual({ host: '192.168.1.9', port: 8123 })
  })

  it('rejects input without a usable port', () => {
    expect(parseLanHostPort(undefined)).toBeNull()
    expect(parseLanHostPort('192.168.1.9')).toBeNull()
    expect(parseLanHostPort('192.168.1.9:')).toBeNull()
    expect(parseLanHostPort('192.168.1.9:no')).toBeNull()
    expect(parseLanHostPort('192.168.1.9:70000')).toBeNull()
  })

  it('keeps the host of a bracketed IPv6 address with a port', () => {
    expect(parseLanHostPort('[fe80::1]:8123')).toEqual({ host: 'fe80::1', port: 8123 })
  })
})
