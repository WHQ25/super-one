import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { WireEncoder, WireDecoder, encodePlainMessage } from '@superone/shared/environment/wire'
import { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame, type LinkHostInfo } from './phone-link'
import { acceptClientHello, issueChannelCredential, type SecureChannel } from './secure-channel'
import type { HostLink } from './client'
import { MIN_PHONE_DESKTOP_VERSION } from './phone-version'

/** Test-only host half of the phone link, independent of the phone's decoder. */

export const TEST_ROOT_SECRET = '0123456789abcdef'.repeat(4)
export const TEST_LINK: HostLink = {
  credential: issueChannelCredential(TEST_ROOT_SECRET, 'test-phone-key'),
  roomId: '0f'.repeat(16),
}

type TestSocket = { sent: string[]; emit(obj: unknown): void }

export class TestHost {
  private readonly encoder = new WireEncoder({ deflate: (bytes, dictionary) => deflateRawSync(bytes, { dictionary }) })
  private readonly decoder = new WireDecoder({ inflate: (bytes, _out, dictionary) => inflateRawSync(bytes, { dictionary }) })
  constructor(readonly channel: SecureChannel, private offset = 0) {}

  openRpc(data: string): Record<string, unknown> | undefined {
    const { header, payload } = openLinkFrame(this.channel, data)
    if (header.t !== 'rpc') throw new Error(`expected rpc, got ${header.t}`)
    return this.decoder.decode(payload) as Record<string, unknown> | undefined
  }

  sendRpc(socket: TestSocket, message: unknown, options: { plain?: boolean; push?: boolean } = {}): void {
    const frames = options.plain ? [encodePlainMessage(message)] : this.encoder.encode(message, options)
    for (const frame of frames) socket.emit({ type: 'terminal', data: sealLinkFrame(this.channel, { t: 'rpc' }, frame) })
  }

  readRpc(socket: TestSocket): Record<string, unknown>[] {
    return socket.sent.slice(this.offset, this.offset = socket.sent.length).flatMap(raw => {
      if (!raw.startsWith('{')) return []
      const frame = JSON.parse(raw) as { type?: string; data?: string }
      if (frame.type !== 'command' || !frame.data) return []
      const message = this.openRpc(frame.data)
      return message ? [message] : []
    })
  }
  replyRpc(socket: TestSocket, result: unknown): Record<string, unknown> {
    const request = this.readRpc(socket).at(-1)
    if (!request) throw new Error('no native request sent')
    this.sendRpc(socket, { type: 'rpc_result', requestId: request.requestId, result })
    return request
  }
}

function parsed(socket: TestSocket): Record<string, unknown>[] {
  return socket.sent.flatMap(raw => { try { return [JSON.parse(raw)] } catch { return [] } })
}

/**
 * Answer the phone's newest hello on `socket` as the host would, and send the
 * sealed handshake. Socket emits are synchronous, so the proof is already sent.
 */
export function completeHandshake(socket: TestSocket, link: HostLink = TEST_LINK, hostName = 'Desk', host?: LinkHostInfo): TestHost {
  const hello = parsed(socket).filter((f) => f.type === LINK_CHANNEL_FRAME && (f.msg as { type?: string })?.type === 'channel_hello').at(-1)
  if (!hello) throw new Error('no channel hello sent')
  const accept = acceptClientHello(hello.msg, (keyId) => keyId === link.credential.keyId ? link.credential.secretHex : null)
  socket.emit({ type: LINK_CHANNEL_FRAME, msg: accept.challenge, hello: (hello.msg as { nonce: string }).nonce })
  const proof = parsed(socket).filter((f) => f.type === LINK_CHANNEL_FRAME && (f.msg as { type?: string })?.type === 'channel_proof').at(-1)
  if (!proof) throw new Error('no channel proof sent')
  const channel = accept.finish(proof.msg)
  const offset = socket.sent.length
  socket.emit({ type: LINK_CHANNEL_FRAME, data: sealLinkFrame(channel, { t: 'handshake', hostName, ...(host ? { host } : {}) }) })
  return new TestHost(channel, offset)
}

export const NATIVE_TEST_HOST = { appVersion: MIN_PHONE_DESKTOP_VERSION, protocol: 3, environmentId: 'desk' }
/** Completes both independent handshakes; receipts and pushes still use the production phone decoder. */
export function completeNativeHandshake(socket: TestSocket, link = TEST_LINK, hostName = 'Desk'): TestHost {
  const host = completeHandshake(socket, link, hostName, NATIVE_TEST_HOST)
  const handshake = host.readRpc(socket).at(-1)
  if (handshake?.type !== 'handshake') throw new Error('no native handshake sent')
  host.sendRpc(socket, { type: 'handshake_ok', requestId: handshake.requestId,
    result: { protocol: 3, databaseSchema: 1, environmentId: NATIVE_TEST_HOST.environmentId } }, { plain: true })
  return host
}
