import { describe, expect, it } from 'vitest'
import { deriveKeys } from './crypto'
import { buildLanWsUrl, buildRelayWsUrl } from './connect'

const MASTER = '0123456789abcdef'.repeat(8)

describe('connect URLs', () => {
  it('builds a signed relay URL without putting the secret in the query', async () => {
    const { url, channelKeyHex } = await buildRelayWsUrl({
      relayUrl: 'wss://relay.example',
      masterSecret: MASTER,
      role: 'mobile',
      deviceId: 'dev-1',
      now: () => 1700000000,
    })
    expect(url).toContain('wss://relay.example/ws?role=mobile')
    expect(url).toContain('deviceId=dev-1')
    expect(url).not.toContain(MASTER)
    expect(channelKeyHex).toBe(deriveKeys(MASTER).channelKeyHex)
  })

  it('builds a LAN ws URL', () => {
    expect(buildLanWsUrl('192.168.1.4', 8787)).toBe('ws://192.168.1.4:8787/ws')
  })
})
