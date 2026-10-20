import type WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { dialWebSocket, type NodeSocket, type NodeSocketDialer } from './node-socket'
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

/** `channel_ready` from a node. `inlineAuth` means this socket accepts auth frames before attach. */
export interface ChannelReady {
  type: 'channel_ready'
  inlineAuth?: boolean
}

/**
 * Run the channel handshake on a socket that has just opened. Resolves once the
 * node's sealed `channel_ready` arrives; listeners it adds are removed again.
 */
export function establishSecureChannel(
  ws: NodeSocket,
  credential: ChannelCredential,
  timeoutMs: number,
): Promise<{ channel: SecureChannel; ready: ChannelReady }> {
  return new Promise((resolve, reject) => {
    const hs = startClientHandshake(credential)
    let channel: SecureChannel | null = null
    let ready: ChannelReady | null = null
    const done = (err: Error | null) => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      if (err) reject(err)
      else resolve({ channel: channel!, ready: ready! })
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
        const frame = channel.open(data as Buffer) as ChannelReady
        if (frame?.type !== 'channel_ready') throw channelError('expected channel_ready')
        ready = frame
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
  /** How to open the socket; a plain WebSocket to `wsUrl` by default. */
  dial?: NodeSocketDialer
}): Promise<{ status: number; body: unknown }> {
  const ws = (input.dial ?? dialWebSocket)(input.wsUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', (err) => reject(channelError(err.message)))
    })
    const { channel } = await establishSecureChannel(ws, input.credential, input.timeoutMs)
    return await exchangeOnSecureChannel(ws, channel, input)
  } finally {
    ws.removeAllListeners()
    ws.on('error', () => {})
    ws.close()
  }
}

/**
 * One auth frame on a channel that is already open. The socket stays open:
 * the caller attaches it or closes it.
 */
export function exchangeOnSecureChannel(
  ws: NodeSocket,
  channel: SecureChannel,
  input: {
    path: string
    body: Record<string, unknown>
    accessToken?: string
    timeoutMs: number
    /** Rejects the exchange when the caller drops the socket. */
    signal?: AbortSignal
  },
): Promise<{ status: number; body: unknown }> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const rejectClosed = () => reject(channelError('encrypted channel closed before the auth response'))
    if (input.signal?.aborted) {
      rejectClosed()
      return
    }
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      input.signal?.removeEventListener('abort', onAbort)
      settle()
    }
    const timer = setTimeout(() => finish(() => reject(channelError('encrypted auth request timeout'))), input.timeoutMs)
    const onAbort = () => finish(rejectClosed)
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = channel.open(data as Buffer) as { type?: string; requestId?: string; status?: number; body?: unknown }
        if (msg.type !== 'auth_result' || msg.requestId !== requestId) return
        finish(() => resolve({ status: msg.status ?? 500, body: msg.body }))
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : channelError(String(err))))
      }
    }
    const onClose = () => finish(rejectClosed)
    input.signal?.addEventListener('abort', onAbort)
    ws.on('message', onMessage)
    ws.on('close', onClose)
    try {
      ws.send(channel.seal({ type: 'auth', requestId, path: input.path, body: input.body, accessToken: input.accessToken }))
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : channelError(String(err))))
    }
  })
}
export type { ChannelCredential, SecureChannel } from '@superone/relay-client/secure-channel'
export type { NodeSocket, NodeSocketDialer } from './node-socket'
