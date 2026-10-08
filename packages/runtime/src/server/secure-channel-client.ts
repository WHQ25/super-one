import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import {
  SecureChannelError,
  startClientHandshake,
  type ChannelCredential,
  type SecureChannel,
} from '@superone/relay-client/secure-channel'

/** Node-side (`ws`) client half of the encrypted node channel served by `startNodeServer`. */

function channelError(message: string): Error {
  return Object.assign(new Error(message), { code: 'unavailable', transport: true })
}

/**
 * Run the channel handshake on a socket that has just opened. Resolves once the
 * node's sealed `channel_ready` arrives; listeners it adds are removed again.
 */
export function establishSecureChannel(
  ws: WebSocket,
  credential: ChannelCredential,
  timeoutMs: number,
): Promise<SecureChannel> {
  return new Promise<SecureChannel>((resolve, reject) => {
    const hs = startClientHandshake(credential)
    let channel: SecureChannel | null = null
    const done = (err: Error | null) => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      if (err) reject(err)
      else resolve(channel!)
    }
    const onClose = (code: number, reason: Buffer) => {
      const message = `encrypted channel closed during handshake (${code} ${reason.toString() || 'no reason'})`
      done(
        reason.toString() === 'channel_auth_failed'
          ? Object.assign(new Error(message), { code: 'unauthorized' })
          : channelError(message),
      )
    }
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      try {
        if (!channel) {
          if (isBinary) throw channelError('expected channel challenge')
          const { proof, channel: established } = hs.finish(JSON.parse(data.toString()))
          channel = established
          ws.send(JSON.stringify(proof))
          return
        }
        const ready = channel.open(data as Buffer) as { type?: string }
        if (ready?.type !== 'channel_ready') throw channelError('expected channel_ready')
        done(null)
      } catch (err) {
        // A wrong secret blocks the connection; anything else is a transport fault.
        if (err instanceof SecureChannelError && err.code === 'channel_auth_failed') {
          done(Object.assign(new Error(err.message), { code: 'unauthorized', cause: err }))
          return
        }
        done(channelError(err instanceof Error ? err.message : String(err)))
      }
    }
    const timer = setTimeout(() => done(channelError('encrypted channel handshake timeout')), timeoutMs)
    ws.on('message', onMessage)
    ws.on('close', onClose)
    ws.send(JSON.stringify(hs.hello))
  })
}

/**
 * One pairing/refresh/ticket exchange over a short-lived encrypted socket.
 * Mirrors the plain HTTP endpoint: same path, body, status and response body.
 */
export async function secureChannelAuthRequest(input: {
  wsUrl: string
  credential: ChannelCredential
  path: '/v1/pair' | '/v1/token' | '/v1/ws-ticket'
  body: Record<string, unknown>
  accessToken?: string
  timeoutMs: number
}): Promise<{ status: number; body: unknown }> {
  const ws = new WebSocket(input.wsUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', (err) => reject(channelError(err.message)))
    })
    const channel = await establishSecureChannel(ws, input.credential, input.timeoutMs)
    const requestId = randomUUID()
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(channelError('encrypted auth request timeout')), input.timeoutMs)
      ws.on('message', (data) => {
        try {
          const msg = channel.open(data as Buffer) as { type?: string; requestId?: string; status?: number; body?: unknown }
          if (msg.type !== 'auth_result' || msg.requestId !== requestId) return
          clearTimeout(timer)
          resolve({ status: msg.status ?? 500, body: msg.body })
        } catch (err) {
          clearTimeout(timer)
          reject(err)
        }
      })
      ws.once('close', () => {
        clearTimeout(timer)
        reject(channelError('encrypted channel closed before the auth response'))
      })
      ws.send(
        channel.seal({ type: 'auth', requestId, path: input.path, body: input.body, accessToken: input.accessToken }),
      )
    })
  } finally {
    ws.removeAllListeners()
    ws.on('error', () => {})
    ws.close()
  }
}
export type { ChannelCredential, SecureChannel } from '@superone/relay-client/secure-channel'
