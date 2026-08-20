import { describe, expect, it } from 'vitest'
import { decryptPairResponse, encryptPairRequest, parsePairQr } from './pair'
import { encryptPayload, hexToByteArray } from './crypto'

describe('pairing QR', () => {
  it('parses superone://pair URLs', () => {
    const q = parsePairQr('superone://pair?channel=abc&key=def&deviceId=desk&relay=wss%3A%2F%2Frelay.example')
    expect(q).toEqual({
      channelId: 'abc',
      tempKeyHex: 'def',
      desktopDeviceId: 'desk',
      relayUrl: 'wss://relay.example',
    })
  })

  it('round-trips pair_request under the QR temp key', () => {
    const key = 'ab'.repeat(32)
    const data = encryptPairRequest(key, { code: '123456', mobileDeviceId: 'm1', deviceName: 'Phone' })
    const opened = decryptPairResponse(key, encryptPayload(hexToByteArray(key), {
      masterSecret: 'secret',
      hostName: 'Mac',
      relayUrl: 'wss://r',
    }))
    expect(opened.masterSecret).toBe('secret')
    expect(hexToByteArray(key).length).toBe(32)
    expect(data.length).toBeGreaterThan(20)
  })
})
