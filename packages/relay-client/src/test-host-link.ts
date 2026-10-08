import { deflateRawSync } from 'node:zlib'
import { frameRemotePayload } from '@superone/shared/remote-payload'
import { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame, type LinkHeader } from './phone-link'
import { acceptClientHello, issueChannelCredential, type SecureChannel } from './secure-channel'
import type { HostLink } from './client'

/** Test-only host half of the phone link, independent of the phone's decoder. */

export const TEST_ROOT_SECRET = '0123456789abcdef'.repeat(4)
export const TEST_LINK: HostLink = {
  credential: issueChannelCredential(TEST_ROOT_SECRET, 'test-phone-key'),
  roomId: '0f'.repeat(16),
}

export function hostFrame(payload: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  return frameRemotePayload(json, json.length > 512 ? deflateRawSync(json) : undefined)
}

type TestSocket = { sent: string[]; emit(obj: unknown): void }

export class TestHost {
  constructor(readonly channel: SecureChannel) {}

  /** `data` for an event, terminal or response envelope. */
  seal(kind: 'event' | 'terminal', payload: unknown): string
  seal(kind: 'response', payload: unknown, requestId: string): string
  seal(kind: 'event' | 'terminal' | 'response', payload: unknown, requestId?: string): string {
    const header: LinkHeader = kind === 'response' ? { t: 'response', requestId: requestId! } : { t: kind }
    return sealLinkFrame(this.channel, header, hostFrame(payload))
  }

  /** Open one `command` envelope's data. */
  openCommand(data: string): Record<string, unknown> {
    const { header, payload } = openLinkFrame(this.channel, data)
    if (header.t !== 'command') throw new Error(`expected command, got ${header.t}`)
    return JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>
  }

  /** Open the newest `command` the phone sent on `socket`. */
  lastCommand(socket: TestSocket): Record<string, unknown> {
    const frame = parsed(socket).filter((f) => f.type === 'command').at(-1)
    if (!frame) throw new Error('no command sent')
    return this.openCommand(frame.data as string)
  }

  /** Answer the newest command with `body`. */
  reply(socket: TestSocket, body: unknown): Record<string, unknown> {
    const command = this.lastCommand(socket)
    const requestId = command.requestId as string
    socket.emit({ type: 'response', requestId, data: this.seal('response', body, requestId) })
    return command
  }
}

function parsed(socket: TestSocket): Record<string, unknown>[] {
  return socket.sent.flatMap((raw) => {
    try { return [JSON.parse(raw) as Record<string, unknown>] } catch { return [] }
  })
}

/**
 * Answer the phone's newest hello on `socket` as the host would, and send the
 * sealed handshake. Socket emits are synchronous, so the proof is already sent.
 */
export function completeHandshake(socket: TestSocket, link: HostLink = TEST_LINK, hostName = 'Desk'): TestHost {
  const hello = parsed(socket).filter((f) => f.type === LINK_CHANNEL_FRAME && (f.msg as { type?: string })?.type === 'channel_hello').at(-1)
  if (!hello) throw new Error('no channel hello sent')
  const accept = acceptClientHello(hello.msg, (keyId) => keyId === link.credential.keyId ? link.credential.secretHex : null)
  socket.emit({ type: LINK_CHANNEL_FRAME, msg: accept.challenge, hello: (hello.msg as { nonce: string }).nonce })
  const proof = parsed(socket).filter((f) => f.type === LINK_CHANNEL_FRAME && (f.msg as { type?: string })?.type === 'channel_proof').at(-1)
  if (!proof) throw new Error('no channel proof sent')
  const channel = accept.finish(proof.msg)
  socket.emit({ type: LINK_CHANNEL_FRAME, data: sealLinkFrame(channel, { t: 'handshake', hostName }) })
  return new TestHost(channel)
}
