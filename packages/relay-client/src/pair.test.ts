import { describe, expect, it } from 'vitest'
import { OutdatedDesktopPairingError, decryptPairResponse, encryptPairRequest, parsePairQr, startPairingHandshake } from './pair'
import { encryptPayload, hexToByteArray } from './crypto'

const CREDENTIAL = { keyId: 'phone-key-0001', secretHex: 'cd'.repeat(32) }
const ROOM = '0f'.repeat(16)

describe('pairing QR', () => {
  it('parses superone://pair URLs', () => {
    const key = 'ab'.repeat(32)
    const q = parsePairQr(`superone://pair?channel=abc&key=${key}&deviceId=desk&relay=wss%3A%2F%2Frelay.example`)
    expect(q).toEqual({
      channelId: 'abc',
      tempKeyHex: key,
      desktopDeviceId: 'desk',
      relayUrl: 'wss://relay.example',
    })
  })

  it('rejects lookalike URLs, invalid keys, and unsafe relay schemes', () => {
    const key = 'ab'.repeat(32)
    expect(() => parsePairQr(`superone://pair-evil?channel=a&key=${key}&deviceId=d&relay=wss://r`))
      .toThrow('not a SuperOne')
    expect(() => parsePairQr('superone://pair?channel=a&key=bad&deviceId=d&relay=wss://r'))
      .toThrow('key is invalid')
    expect(() => parsePairQr(`superone://pair?channel=a&key=${key}&deviceId=d&relay=https://r`))
      .toThrow('must use ws or wss')
  })

  it('round-trips pair_request under the QR temp key', () => {
    const key = 'ab'.repeat(32)
    const data = encryptPairRequest(key, { code: '123456', mobileDeviceId: 'm1', deviceName: 'Phone' })
    const opened = decryptPairResponse(key, encryptPayload(hexToByteArray(key), {
      credential: CREDENTIAL,
      roomId: ROOM,
      hostName: 'Mac',
      relayUrl: 'wss://r',
    }))
    expect(opened).toEqual({ credential: CREDENTIAL, roomId: ROOM, hostName: 'Mac', relayUrl: 'wss://r' })
    expect(hexToByteArray(key).length).toBe(32)
    expect(data.length).toBeGreaterThan(20)
  })

  it('rejects a shared-secret response from a desktop that predates per-device credentials', () => {
    const key = 'ab'.repeat(32)
    const legacy = encryptPayload(hexToByteArray(key), { masterSecret: 'cd'.repeat(32), hostName: 'Mac', relayUrl: 'wss://r' })
    expect(() => decryptPairResponse(key, legacy)).toThrow(OutdatedDesktopPairingError)
    const malformed = encryptPayload(hexToByteArray(key), { credential: { keyId: 'k', secretHex: 'x' }, roomId: ROOM })
    expect(() => decryptPairResponse(key, malformed)).toThrow('channel credential')
  })

  it('completes the encrypted pairing handshake and closes its socket', async () => {
    const key = 'ab'.repeat(32)
    const socket = {
      sent: [] as string[],
      closed: false,
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: string }) => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      send(data: string) { this.sent.push(data) },
      close() { this.closed = true },
    }
    const { done } = startPairingHandshake({
      qr: { channelId: 'c', tempKeyHex: key, desktopDeviceId: 'd', relayUrl: 'wss://relay.example' },
      mobileDeviceId: 'mobile',
      deviceName: 'Phone',
      openSocket: () => socket,
    })
    socket.onopen?.()
    expect(socket.sent).toHaveLength(1)
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'pair_response',
        data: encryptPayload(hexToByteArray(key), {
          credential: CREDENTIAL,
          roomId: ROOM,
          hostName: 'Mac',
          relayUrl: 'ws://desktop-internal:8787',
        }),
      }),
    })
    await expect(done).resolves.toEqual({
      credential: CREDENTIAL,
      roomId: ROOM,
      hostName: 'Mac',
      relayUrl: 'wss://relay.example',
    })
    expect(socket.closed).toBe(true)
  })
})
