import { decryptPayload, encryptPayload, hexToByteArray } from './crypto'

export type PairQr = {
  channelId: string
  tempKeyHex: string
  desktopDeviceId: string
  relayUrl: string
}

export function parsePairQr(raw: string): PairQr {
  const uri = new URL(raw)
  if (uri.protocol !== 'superone:' || uri.hostname !== 'pair') {
    throw new Error('not a SuperOne pairing QR')
  }
  const q = uri.searchParams
  const channelId = q.get('channel') ?? ''
  const tempKeyHex = q.get('key') ?? ''
  const desktopDeviceId = q.get('deviceId') ?? ''
  const relayUrl = q.get('relay') ?? ''
  if (!channelId || !tempKeyHex || !desktopDeviceId || !relayUrl) {
    throw new Error('QR is missing channel, key, deviceId, or relay')
  }
  if (!/^[0-9a-f]{64}$/i.test(tempKeyHex)) throw new Error('QR pairing key is invalid')
  const relay = new URL(relayUrl)
  if (relay.protocol !== 'ws:' && relay.protocol !== 'wss:') {
    throw new Error('QR relay URL must use ws or wss')
  }
  return { channelId, tempKeyHex, desktopDeviceId, relayUrl }
}

export function generatePairCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function pairWsUrl(relayUrl: string, channelId: string): string {
  return `${relayUrl.replace(/\/$/, '')}/pair?channel=${encodeURIComponent(channelId)}&role=mobile`
}

export function encryptPairRequest(
  tempKeyHex: string,
  payload: { code: string; mobileDeviceId: string; deviceName: string },
): string {
  return encryptPayload(hexToByteArray(tempKeyHex), payload)
}

export function decryptPairResponse(tempKeyHex: string, data: string): {
  masterSecret: string
  hostName: string
  relayUrl: string
} {
  const decrypted = decryptPayload(hexToByteArray(tempKeyHex), data) as Record<string, unknown>
  const masterSecret = decrypted.masterSecret
  if (typeof masterSecret !== 'string' || !masterSecret) throw new Error('pair_response missing masterSecret')
  return {
    masterSecret,
    hostName: typeof decrypted.hostName === 'string' ? decrypted.hostName : 'Desktop',
    relayUrl: typeof decrypted.relayUrl === 'string' ? decrypted.relayUrl : '',
  }
}

export type PairResult = { masterSecret: string; hostName: string; relayUrl: string }

export function startPairingHandshake(opts: {
  qr: PairQr
  mobileDeviceId: string
  deviceName: string
  openSocket: (url: string) => {
    send(data: string): void
    close(): void
    onopen: ((ev?: unknown) => void) | null
    onmessage: ((ev: { data: string }) => void) | null
    onclose: ((ev?: unknown) => void) | null
    onerror: ((ev?: unknown) => void) | null
  }
}): { code: string; done: Promise<PairResult> } {
  const code = generatePairCode()
  const ws = opts.openSocket(pairWsUrl(opts.qr.relayUrl, opts.qr.channelId))
  const done = new Promise<PairResult>((resolve, reject) => {
    let settled = false
    const finish = (result: { ok: true; value: PairResult } | { ok: false; error: unknown }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result.ok) resolve(result.value)
      else reject(result.error)
      ws.close()
    }
    const timer = setTimeout(() => finish({ ok: false, error: new Error('pairing timeout') }), 3 * 60 * 1000)
    ws.onerror = () => {
      finish({ ok: false, error: new Error('pairing socket error') })
    }
    ws.onclose = () => {
      if (!settled) finish({ ok: false, error: new Error('pairing socket closed') })
    }
    ws.onopen = () => {
      try {
        const data = encryptPairRequest(opts.qr.tempKeyHex, {
          code,
          mobileDeviceId: opts.mobileDeviceId,
          deviceName: opts.deviceName,
        })
        ws.send(JSON.stringify({ type: 'pair_request', data }))
      } catch (error) {
        finish({ ok: false, error })
      }
    }
    ws.onmessage = (ev) => {
      let frame: { type?: string; data?: string }
      try {
        frame = JSON.parse(String(ev.data)) as { type?: string; data?: string }
      } catch {
        return
      }
      if (frame.type === 'pair_rejected') {
        finish({ ok: false, error: new Error('pairing rejected') })
        return
      }
      if (frame.type === 'pair_already_paired') {
        finish({ ok: false, error: new Error('already paired') })
        return
      }
      if (frame.type === 'pair_response' && frame.data) {
        try {
          const result = decryptPairResponse(opts.qr.tempKeyHex, frame.data)
          // Keep using the endpoint that completed the handshake. The desktop may be
          // advertising an internal address that is unreachable through NAT or a proxy.
          finish({ ok: true, value: { ...result, relayUrl: opts.qr.relayUrl } })
        } catch (error) {
          finish({ ok: false, error })
        }
      }
    }
  })
  return { code, done }
}
