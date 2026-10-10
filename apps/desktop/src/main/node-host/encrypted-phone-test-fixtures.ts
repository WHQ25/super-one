import { RelayClient, type SocketLike } from '@superone/relay-client'
import { acceptClientHello, issueChannelCredential, type SecureChannel } from '@superone/relay-client/secure-channel'
import { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { openPhoneConnection, type PhoneConnection } from './phone-endpoint'
import type { DesktopDomain } from './desktop-domain'

export async function encryptedPhone(cleanup: Array<() => void>, domain: DesktopDomain, route: 'lan' | 'relay', deviceId: string, events: unknown[][] = [], hooks: NonNullable<ConstructorParameters<typeof RelayClient>[0]> = {}) {
  const credential = issueChannelCredential('aa'.repeat(32), `test-phone-key-${deviceId}`)
  let accepted: ReturnType<typeof acceptClientHello>
  let channel: SecureChannel
  let connection: PhoneConnection
  const socket: SocketLike = {
    onopen: null, onmessage: null, onclose: null, onerror: null,
    close: () => connection?.close(),
    send: (text) => {
      if (text === 'ping') { socket.onmessage?.({ data: 'pong' }); return }
      const envelope = JSON.parse(text) as { type: string; msg?: { type?: string; nonce?: string }; data?: string }
      const emit = (value: unknown) => socket.onmessage?.({ data: JSON.stringify(value) })
      if (envelope.type === LINK_CHANNEL_FRAME && envelope.msg?.type === 'channel_hello') {
        accepted = acceptClientHello(envelope.msg, (keyId) => keyId === credential.keyId ? credential.secretHex : null)
        emit({ type: LINK_CHANNEL_FRAME, msg: accepted.challenge, hello: envelope.msg.nonce })
      } else if (envelope.type === LINK_CHANNEL_FRAME && envelope.msg?.type === 'channel_proof') {
        channel = accepted.finish(envelope.msg)
        connection = openPhoneConnection(domain, {
          deviceId, keyId: credential.keyId, transport: route, buffered: () => 0,
          write: (frame) => emit({ type: 'terminal', data: sealLinkFrame(channel, { t: 'rpc' }, frame) }),
          close: () => socket.onclose?.(),
        })
        emit({ type: LINK_CHANNEL_FRAME, data: sealLinkFrame(channel, { t: 'handshake', hostName: 'Desk', host: { appVersion: '0.73.0-alpha.1', protocol: 3, environmentId: domain.identity.environmentId } }) })
      } else if (envelope.type === 'command' && envelope.data) {
        const frame = openLinkFrame(channel, envelope.data)
        if (frame.header.t !== 'rpc') throw new Error('phone sent a legacy application frame')
        connection.receive(frame.payload)
      }
    },
  }
  const client = new RelayClient({ ...hooks, onEvents: (batch, epoch) => { events.push(batch); hooks.onEvents?.(batch, epoch) }, openSocket: () => { queueMicrotask(() => socket.onopen?.()); return socket } })
  cleanup.push(() => client.disconnect())
  const link = { credential, roomId: 'bb'.repeat(16) }
  if (route === 'lan') await client.connectLan('127.0.0.1', 9876, link)
  else await client.connectRelay({ relayUrl: 'wss://relay.example', link, deviceId })
  return client
}
