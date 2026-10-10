import { PhoneProtocol } from '@superone/relay-client/phone-protocol'
import { PROTOCOL_GENERATION, type SessionLoadResult } from '@superone/shared/environment'
import { WireDecoder } from '@superone/shared/environment/wire'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { acceptClientHello, issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'
import { openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { RemoteControlService } from '../remote-control-service'
import { phoneDomain } from '../node-host/phone-endpoint-test-fixtures'
import { openPhoneConnection } from '../node-host/phone-endpoint'
import type { DesktopDomain, DesktopDomainDeps } from '../node-host/desktop-domain'
import { createDesktopTopicHub } from './desktop-topics'
import { createDesktopTopicNotices } from '../node-host/desktop-topic-notices'
import { LocalTopicRecovery } from './topic-recovery'

/** Measures the actual native phone endpoint through the production relay sender, framing and sealed channel. */
export async function nativePhoneWire(cleanup: Array<() => void>, extra: Partial<DesktopDomainDeps> = {}) {
  const hub = createDesktopTopicHub()
  let domain!: DesktopDomain
  let notices!: ReturnType<typeof createDesktopTopicNotices>
  let recovery!: LocalTopicRecovery
  const fixture = phoneDomain(cleanup, { topicNotices: { open: input => {
    recovery ??= new LocalTopicRecovery(domain.identity.environmentId, () => null)
    notices ??= createDesktopTopicNotices(hub, recovery, domain.identity.environmentId)
    return notices.open(input)
  } }, ...extra })
  domain = fixture.domain
  const credential = issueChannelCredential('ab'.repeat(32), 'key-phone-1')
  const clientHello = startClientHandshake(credential)
  const accepted = acceptClientHello(clientHello.hello, () => credential.secretHex)
  const { proof, channel: phone } = clientHello.finish(accepted.challenge)
  const host = accepted.finish(proof)
  const sent: string[] = []
  const decoded: unknown[] = []
  const decoder = new WireDecoder(nodeWireCompression)
  let connection!: PhoneProtocol
  const service = new RemoteControlService('wss://relay.example', { openPhoneConnection: link => openPhoneConnection(domain, link) })
  const internals = service as unknown as {
    keys: unknown; phoneLink: unknown; relayWs: unknown; relayLinks: Map<string, unknown>
    receiveRelayRpc(deviceId: string, link: unknown, frame: Uint8Array): void
  }
  const relay = { handshake: null, channel: host, device: { keyId: credential.keyId, deviceId: 'phone-1', deviceName: 'Phone', secretHex: '', enabled: true }, rpc: null as { close(): void } | null }
  internals.keys = { rootSecret: 'ab'.repeat(32), channelKeyHex: 'c' }
  internals.phoneLink = await import('../remote/phone-link-host')
  internals.relayLinks.set('phone-1', relay)
  internals.relayWs = { readyState: 1, bufferedAmount: 0, send(text: string) {
    sent.push(text)
    const envelope = JSON.parse(text) as { data: string }
    const frame = openLinkFrame(phone, envelope.data)
    if (frame.header.t !== 'rpc') throw new Error('Legacy host application frame used')
    const message = decoder.decode(frame.payload)
    if (message !== undefined) decoded.push(message)
    connection.receive(frame.payload)
  } }
  connection = new PhoneProtocol({ appVersion: '0.73.0-alpha.1', protocol: PROTOCOL_GENERATION.current, environmentId: domain.identity.environmentId }, frame => {
    const ingress = openLinkFrame(host, sealLinkFrame(phone, { t: 'rpc' }, frame))
    internals.receiveRelayRpc('phone-1', relay, ingress.payload)
  }, () => {})
  cleanup.push(() => { relay.rpc?.close(); connection.close(new Error('closed')) })
  await connection.start()
  const rpc = <T>(method: string, payload: unknown = {}) => connection.rpc<T>(method, payload, { environmentId: domain.identity.environmentId, timeoutMs: 1000 })
  await connection.subscribe({ afterSequence: '0', topics: [{ kind: 'sessionList', environmentId: domain.identity.environmentId }] }, { onFrame: () => {}, onEnd: () => {} })
  const subscribe = async (sessionId: string) => {
    const loaded = await rpc<SessionLoadResult>('session.load', { sessionId, limit: 8 })
    await connection.subscribe({ afterSequence: loaded.cursor.sequence, epoch: loaded.cursor.epoch,
      versions: { [sessionId]: loaded.cursor.version }, topics: [{ kind: 'session', environmentId: domain.identity.environmentId, sessionId }] }, { onFrame: () => {}, onEnd: () => {} })
    return loaded
  }
  return { ...fixture, hub, recovery: () => recovery, rpc, subscribe, decoded, sent, connection,
    mark: () => ({ wire: sent.length, decoded: decoded.length }),
    measure: (mark: { wire: number; decoded: number }) => ({ frames: sent.length - mark.wire,
      bytes: sent.slice(mark.wire).reduce((sum, text) => sum + Buffer.byteLength(text), 0), messages: decoded.slice(mark.decoded) }),
  }
}
