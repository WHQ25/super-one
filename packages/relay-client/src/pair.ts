import { decryptPayload, encryptPayload, hexToByteArray } from './crypto'
import type { ChannelCredential } from './secure-channel'
import { generatePairCode, joinPairRoom, pairRoomUrl, type OpenPairRoomSocket } from './pair-room'

export type PairQr = {
  channelId: string
  tempKeyHex: string
  desktopDeviceId: string
  relayUrl: string
}

export function parsePairQr(raw: string): PairQr {
  const { params, channelId, tempKeyHex, relayUrl } = readPairQr(raw, 'pair')
  const desktopDeviceId = params.get('deviceId') ?? ''
  if (!desktopDeviceId) throw new Error('QR is missing channel, key, deviceId, or relay')
  return { channelId, tempKeyHex, desktopDeviceId, relayUrl }
}

/**
 * The room part every pairing QR shares: `superone://<host>?channel&key&relay`.
 * Exported for the desktop-pairing QRs (`desktop-pair.ts`).
 */
export function readPairQr(raw: string, host: string): {
  params: URLSearchParams
  channelId: string
  tempKeyHex: string
  relayUrl: string
} {
  const uri = new URL(raw)
  if (uri.protocol !== 'superone:' || uri.hostname !== host) {
    throw new Error('not a SuperOne pairing QR')
  }
  const params = uri.searchParams
  const channelId = params.get('channel') ?? ''
  const tempKeyHex = params.get('key') ?? ''
  const relayUrl = params.get('relay') ?? ''
  if (!channelId || !tempKeyHex || !relayUrl) {
    throw new Error('QR is missing channel, key, deviceId, or relay')
  }
  if (!/^[0-9a-f]{64}$/i.test(tempKeyHex)) throw new Error('QR pairing key is invalid')
  const relay = new URL(relayUrl)
  if (relay.protocol !== 'ws:' && relay.protocol !== 'wss:') {
    throw new Error('QR relay URL must use ws or wss')
  }
  return { params, channelId, tempKeyHex, relayUrl }
}

export function pairWsUrl(relayUrl: string, channelId: string): string {
  return pairRoomUrl(relayUrl, channelId, 'mobile')
}

export function encryptPairRequest(
  tempKeyHex: string,
  payload: { code: string; mobileDeviceId: string; deviceName: string },
): string {
  return encryptPayload(hexToByteArray(tempKeyHex), payload)
}

const KEY_ID = /^[A-Za-z0-9_-]{8,128}$/
const HEX_64 = /^[0-9a-f]{64}$/
const ROOM_ID = /^[0-9a-f]{32}$/

/** Thrown when a desktop answers with the retired shared-secret pairing. */
export class OutdatedDesktopPairingError extends Error {
  constructor() {
    super('This desktop must be updated before it can pair')
    this.name = 'OutdatedDesktopPairingError'
  }
}

/**
 * The pairing response is sealed under the QR's temporary key, which only the
 * phone that scanned it holds. It issues this phone its own channel credential
 * (the host derives it from its root and the key id) and the host's relay room.
 */
export function decryptPairResponse(tempKeyHex: string, data: string): PairResult {
  return readPairResponse(decryptPayload(hexToByteArray(tempKeyHex), data) as Record<string, unknown>)
}

function readPairResponse(decrypted: Record<string, unknown>): PairResult {
  const credential = decrypted.credential as Record<string, unknown> | undefined
  if (!credential && typeof decrypted.masterSecret === 'string') throw new OutdatedDesktopPairingError()
  const keyId = credential?.keyId
  const secretHex = credential?.secretHex
  const roomId = decrypted.roomId
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId) || typeof secretHex !== 'string' || !HEX_64.test(secretHex)) {
    throw new Error('pair_response missing channel credential')
  }
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new Error('pair_response missing room')
  return {
    credential: { keyId, secretHex },
    roomId,
    hostName: typeof decrypted.hostName === 'string' ? decrypted.hostName : 'Desktop',
    relayUrl: typeof decrypted.relayUrl === 'string' ? decrypted.relayUrl : '',
  }
}

export type PairResult = { credential: ChannelCredential; roomId: string; hostName: string; relayUrl: string }

export function startPairingHandshake(opts: {
  qr: PairQr
  mobileDeviceId: string
  deviceName: string
  openSocket: OpenPairRoomSocket
}): { code: string; done: Promise<PairResult> } {
  const code = generatePairCode()
  const room = joinPairRoom<PairResult>({
    relayUrl: opts.qr.relayUrl,
    channelId: opts.qr.channelId,
    tempKeyHex: opts.qr.tempKeyHex,
    role: 'mobile',
    openSocket: opts.openSocket,
    onOpen: (r) => r.send('pair_request', { code, mobileDeviceId: opts.mobileDeviceId, deviceName: opts.deviceName }),
    onFrame: (frame, settle) => {
      if (frame.type === 'pair_rejected') settle({ ok: false, error: new Error('pairing rejected') })
      else if (frame.type === 'pair_already_paired') settle({ ok: false, error: new Error('already paired') })
      else if (frame.type === 'pair_response' && frame.body) {
        // Keep using the endpoint that completed the handshake. The desktop may be
        // advertising an internal address that is unreachable through NAT or a proxy.
        settle({ ok: true, value: { ...readPairResponse(frame.body), relayUrl: opts.qr.relayUrl } })
      }
    },
  })
  return { code, done: room.done }
}
