import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { setCryptoBackend, type AesGcm } from '@superone/relay-client'
import { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame, type LinkHandshakeInfo, type LinkHeader } from '@superone/relay-client/phone-link'
import { acceptClientHello, type SecureChannel } from '@superone/relay-client/secure-channel'

/**
 * Host half of the phone link (relay-client `phone-link.ts`), shared by the LAN
 * server and the relay connection. A phone proves the secret issued to it at
 * pairing; the host derives that secret from its root and the key id, so a
 * removed device's key id no longer resolves. Format: docs/architecture/relay-crypto.md.
 *
 * Load this module with a dynamic `import()` (or import only its types): the
 * noble crypto it pulls in must not land in the eager main chunk.
 */

const TAG_BYTES = 16

/** OpenSSL AES-GCM for the shared sealing code; pure JS would block Electron main on large frames. */
const nodeAesGcm: AesGcm = {
  seal(key, iv, plaintext, aad) {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    if (aad) cipher.setAAD(aad)
    const head = cipher.update(plaintext)
    const tail = cipher.final()
    return new Uint8Array(Buffer.concat([head, tail, cipher.getAuthTag()]))
  },
  open(key, iv, sealed, aad) {
    if (sealed.length < TAG_BYTES) throw new Error('ciphertext too short')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    if (aad) decipher.setAAD(aad)
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
    const head = decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES))
    return new Uint8Array(Buffer.concat([head, decipher.final()]))
  },
}
setCryptoBackend({ aesGcm: nodeAesGcm })

export { deriveIssuedChannelSecret } from '@superone/relay-client/secure-channel'

/** This module's shape, for holders of the lazily loaded module. */
export type PhoneLinkHost = typeof import('./phone-link-host')

/** A paired phone as the host knows it, resolved from the key id it presents. */
export type PhoneKey = {
  keyId: string
  deviceId: string
  deviceName: string
  secretHex: string
  /** False while this desktop keeps the phone out without unpairing it. */
  enabled: boolean
}
export type ResolvePhoneKey = (keyId: string) => PhoneKey | null

/**
 * The pairing a channel was opened under still stands: its key id resolves to
 * the same device and secret. Checked when the handshake completes and before
 * each command, so removing a device cuts it off even mid-handshake.
 */
export function stillPaired(resolve: ResolvePhoneKey, device: PhoneKey): boolean {
  const live = resolve(device.keyId)
  return live !== null && live.deviceId === device.deviceId && live.secretHex === device.secretHex
}

/**
 * The phone may use its channel now. A switched-off phone is turned away
 * without `kicked`, which would make it forget the pairing.
 */
export function phoneAllowed(resolve: ResolvePhoneKey, device: PhoneKey): boolean {
  return resolve(device.keyId)?.enabled === true
}

export type ChannelEnvelope = { type: typeof LINK_CHANNEL_FRAME; msg?: unknown; hello?: unknown; data?: unknown }

export type HandshakeStep =
  | { kind: 'challenge'; reply: ChannelEnvelope }
  | { kind: 'established'; channel: SecureChannel; device: PhoneKey }
  /** Unknown or revoked key id, or a device presenting another device's key. */
  | { kind: 'rejected'; reason: string }
  /** Malformed or out-of-turn message, or a proof that does not verify. */
  | { kind: 'failed'; reason: string }

/** Handshake state for one phone connection (a LAN socket, or a phone's relay slot). */
export class PhoneHandshake {
  private pending: { accept: ReturnType<typeof acceptClientHello>; device: PhoneKey } | null = null

  constructor(
    private readonly resolve: ResolvePhoneKey,
    /** On the relay the slot names the device; its key must belong to it. */
    private readonly expectedDeviceId?: string,
  ) {}

  /** The device whose proof this handshake is waiting for, so revoking it can cancel the wait. */
  get pendingDeviceId(): string | null {
    return this.pending?.device.deviceId ?? null
  }

  step(envelope: ChannelEnvelope): HandshakeStep {
    const msg = envelope.msg as { type?: unknown } | undefined
    if (msg?.type === 'channel_hello') {
      this.pending = null
      const found: { device: PhoneKey | null } = { device: null }
      try {
        const accept = acceptClientHello(msg, (keyId) => {
          const device = this.resolve(keyId)
          found.device = device && (this.expectedDeviceId === undefined || device.deviceId === this.expectedDeviceId) ? device : null
          return found.device?.secretHex ?? null
        })
        this.pending = { accept, device: found.device! }
        return { kind: 'challenge', reply: { type: LINK_CHANNEL_FRAME, msg: accept.challenge, hello: (msg as { nonce?: unknown }).nonce } }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        return found.device === null && (err as { code?: string }).code === 'channel_auth_failed'
          ? { kind: 'rejected', reason }
          : { kind: 'failed', reason }
      }
    }
    if (msg?.type === 'channel_proof' && this.pending) {
      const { accept, device } = this.pending
      this.pending = null
      let channel: SecureChannel
      try {
        channel = accept.finish(msg)
      } catch (err) {
        return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) }
      }
      // The device may have been removed since its hello.
      if (!stillPaired(this.resolve, device)) return { kind: 'rejected', reason: 'pairing removed during the handshake' }
      return { kind: 'established', channel, device }
    }
    return { kind: 'failed', reason: 'unexpected channel message' }
  }
}

/** The host's first sealed frame on a new channel: who it is and where its LAN server answers. */
export function sealHandshake(channel: SecureChannel, info: LinkHandshakeInfo): ChannelEnvelope {
  return { type: LINK_CHANNEL_FRAME, data: sealLinkFrame(channel, { t: 'handshake', ...info }) }
}

export function sealHostFrame(channel: SecureChannel, header: Exclude<LinkHeader, { t: 'handshake' | 'command' }>, framed: Uint8Array): string {
  return sealLinkFrame(channel, header, framed)
}

/** What a phone sent: a link command, or a protocol frame for its connection. */
export type PhoneFrame = { kind: 'command'; command: RemoteCommand } | { kind: 'rpc'; frame: Uint8Array }

/** Open a phone's sealed frame; throws on tampering, replay or a frame a phone does not send. */
export function openPhoneFrame(channel: SecureChannel, data: string): PhoneFrame {
  const { header, payload } = openLinkFrame(channel, data)
  if (header.t === 'rpc') return { kind: 'rpc', frame: payload }
  if (header.t !== 'command') throw new Error(`expected command, got ${header.t}`)
  return { kind: 'command', command: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as RemoteCommand }
}

/** Envelope type of a host's protocol frames: forwarded by the relay to its `targets` as sealed. */
export const PHONE_RPC_ENVELOPE = 'terminal'
