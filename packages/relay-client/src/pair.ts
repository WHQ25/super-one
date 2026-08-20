import { decryptPayload, encryptPayload, hexToByteArray } from './crypto'

export type PairQr = {
  channelId: string
  tempKeyHex: string
  desktopDeviceId: string
  relayUrl: string
}

export function parsePairQr(raw: string): PairQr {
  if (!raw.startsWith('superone://pair')) throw new Error('not a SuperOne pairing QR')
  const uri = new URL(raw)
  const q = uri.searchParams
  const channelId = q.get('channel') ?? ''
  const tempKeyHex = q.get('key') ?? ''
  const desktopDeviceId = q.get('deviceId') ?? ''
  const relayUrl = q.get('relay') ?? ''
  if (!channelId || !tempKeyHex || !desktopDeviceId || !relayUrl) {
    throw new Error('QR is missing channel, key, deviceId, or relay')
  }
  return { channelId, tempKeyHex, desktopDeviceId, relayUrl }
}

export function generatePairCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function pairWsUrl(relayUrl: string, channelId: string): string {
  return `${relayUrl.replace(/\/$/, '')}/pair?channel=${channelId}&role=mobile`
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
    const timer = setTimeout(() => reject(new Error('pairing timeout')), 3 * 60 * 1000)
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('pairing socket error'))
    }
    ws.onopen = () => {
      const data = encryptPairRequest(opts.qr.tempKeyHex, {
        code,
        mobileDeviceId: opts.mobileDeviceId,
        deviceName: opts.deviceName,
      })
      ws.send(JSON.stringify({ type: 'pair_request', data }))
    }
    ws.onmessage = (ev) => {
      let frame: { type?: string; data?: string }
      try {
        frame = JSON.parse(String(ev.data)) as { type?: string; data?: string }
      } catch {
        return
      }
      if (frame.type === 'pair_rejected') {
        clearTimeout(timer)
        reject(new Error('pairing rejected'))
        ws.close()
        return
      }
      if (frame.type === 'pair_already_paired') {
        clearTimeout(timer)
        reject(new Error('already paired'))
        ws.close()
        return
      }
      if (frame.type === 'pair_response' && frame.data) {
        clearTimeout(timer)
        try {
          const result = decryptPairResponse(opts.qr.tempKeyHex, frame.data)
          resolve({ ...result, relayUrl: result.relayUrl || opts.qr.relayUrl })
        } catch (e) {
          reject(e)
        }
        ws.close()
      }
    }
  })
  return { code, done }
}
