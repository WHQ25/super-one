import { describe, expect, it } from 'vitest'
import { buildLanWsUrl, buildRelayWsUrl } from './connect'

describe('connect URLs', () => {
  it('builds a relay URL from the paired room and device slot, with no secret in it', () => {
    const url = buildRelayWsUrl({
      relayUrl: 'wss://relay.example/',
      roomId: '0f'.repeat(16),
      role: 'mobile',
      deviceId: 'dev-1',
      now: () => 1700000000,
    })
    expect(url).toBe(`wss://relay.example/ws?role=mobile&ts=1700000000&room=${'0f'.repeat(16)}&deviceId=dev-1`)
  })

  it('builds a LAN ws URL', () => {
    expect(buildLanWsUrl('192.168.1.4', 8787)).toBe('ws://192.168.1.4:8787/ws')
  })
})
