import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

/**
 * The test connects from loopback; `peer.address` stands in for the address
 * the real classifier sees, so a public source can be exercised end to end.
 */
const peer = vi.hoisted(() => ({ address: null as string | null, seen: [] as Array<string | undefined> }))
vi.mock('@superone/shared/private-network-address', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superone/shared/private-network-address')>()
  return {
    ...actual,
    isPrivateNetworkAddress: (address: string | undefined) => {
      peer.seen.push(address)
      return actual.isPrivateNetworkAddress(peer.address ?? address)
    },
  }
})

import WebSocket from 'ws'
import { issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'
import { LanServer } from './lan-server'
import * as phoneLink from './remote/phone-link-host'

const ROOT = 'ab'.repeat(32)

describe('LanServer source address filter', () => {
  let server: LanServer | null = null
  afterEach(async () => {
    await server?.stop()
    server = null
    peer.address = null
    peer.seen.length = 0
  })

  async function start() {
    const resolveKey = vi.fn(() => ({ deviceId: 'dev-1', deviceName: 'iPhone', secretHex: issueChannelCredential(ROOT, 'key-dev-1').secretHex }))
    const onClientRegistered = vi.fn()
    server = new LanServer({ phoneLink, resolveKey, handshakeInfo: () => ({ hostName: 'h' }), onCommand: vi.fn(), onClientRegistered })
    const { port } = await server.start({ host: '127.0.0.1' })
    return { port, resolveKey, onClientRegistered }
  }

  function tryPhone(port: number): Promise<'open' | 'refused'> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'channel', msg: startClientHandshake(issueChannelCredential(ROOT, 'key-dev-1')).hello }))
        ws.close()
        resolve('open')
      })
      ws.once('error', () => resolve('refused'))
    })
  }

  it('drops a public source address before the upgrade, handshake or register', async () => {
    const { port, resolveKey, onClientRegistered } = await start()
    peer.address = '203.0.113.7'
    expect(await tryPhone(port)).toBe('refused')
    expect(peer.seen[0]).toMatch(/127\.0\.0\.1/)
    expect(resolveKey).not.toHaveBeenCalled()
    expect(onClientRegistered).not.toHaveBeenCalled()
  })

  it('serves a private source address', async () => {
    const { port, resolveKey } = await start()
    peer.address = '192.168.1.20'
    expect(await tryPhone(port)).toBe('open')
    await vi.waitFor(() => expect(resolveKey).toHaveBeenCalled())
  })
})
