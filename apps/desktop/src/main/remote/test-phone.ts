import WebSocket from 'ws'
import { openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { startClientHandshake, type ChannelCredential, type SecureChannel } from '@superone/relay-client/secure-channel'

/** Test-only raw phone for the LAN link: runs the handshake by hand so tests can misbehave on the wire. */

export function nextFrame(ws: WebSocket, predicate?: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), 2000)
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(raw.toString())
        if (!predicate || predicate(frame)) {
          clearTimeout(timer)
          ws.off('message', onMessage)
          resolve(frame)
        }
      } catch {}
    }
    ws.on('message', onMessage)
  })
}

export async function openLanSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return socket
}

export async function connectTestPhone(port: number, credential: ChannelCredential): Promise<{ socket: WebSocket; channel: SecureChannel; handshake: Record<string, unknown> }> {
  const socket = await openLanSocket(port)
  const hs = startClientHandshake(credential)
  const challenge = nextFrame(socket, (f) => f.type === 'channel')
  socket.send(JSON.stringify({ type: 'channel', msg: hs.hello }))
  const { proof, channel } = hs.finish((await challenge).msg)
  const sealed = nextFrame(socket, (f) => f.type === 'channel')
  socket.send(JSON.stringify({ type: 'channel', msg: proof }))
  const { header } = openLinkFrame(channel, (await sealed).data as string)
  return { socket, channel, handshake: header as Record<string, unknown> }
}

export function sealTestRpc(channel: SecureChannel, body: unknown): string {
  return JSON.stringify({ type: 'command', data: sealLinkFrame(channel, { t: 'rpc' }, new TextEncoder().encode(JSON.stringify(body))) })
}
