import { bytesToHex, equalBytes, hexToBytes, randomBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { aesGcm } from './crypto-backend'
import { deriveKeys } from './crypto'

/**
 * Transport-agnostic encrypted channel keyed by a pairing secret that is
 * exchanged out of band and never sent over the wire. A three-message
 * handshake proves possession of the secret in both directions over fresh
 * nonces, then each direction seals frames with its own per-connection key and
 * a strictly increasing sequence number inside the authenticated plaintext.
 * Format and vectors: docs/architecture/relay-crypto.md.
 */

export const SECURE_CHANNEL_VERSION = 1
const LABEL = 'superone-channel/v1'
const NONCE_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const SEQ_BYTES = 8
const AAD = new TextEncoder().encode(LABEL)
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** What the out-of-band pairing code carries; `secretHex` never crosses the network. */
export interface ChannelCredential {
  keyId: string
  secretHex: string
}

export interface ChannelHello {
  type: 'channel_hello'
  v: typeof SECURE_CHANNEL_VERSION
  keyId: string
  nonce: string
}

export interface ChannelChallenge {
  type: 'channel_challenge'
  v: typeof SECURE_CHANNEL_VERSION
  nonce: string
  proof: string
}

export interface ChannelProof {
  type: 'channel_proof'
  v: typeof SECURE_CHANNEL_VERSION
  proof: string
}

export type SecureChannelErrorCode = 'channel_protocol' | 'channel_auth_failed' | 'channel_replay' | 'channel_decrypt'

export class SecureChannelError extends Error {
  constructor(
    readonly code: SecureChannelErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SecureChannelError'
  }
}

/**
 * Per-pairing secret a node derives from its root secret, so the node stores
 * one root instead of a secret per client.
 */
export function deriveIssuedChannelSecret(rootSecretHex: string, keyId: string): string {
  assertKeyId(keyId)
  return bytesToHex(hmac(sha256, hexToBytes(rootSecretHex), encoder.encode(`${LABEL}|secret|${keyId}`)))
}

export function issueChannelCredential(rootSecretHex: string, keyId: string): ChannelCredential {
  return { keyId, secretHex: deriveIssuedChannelSecret(rootSecretHex, keyId) }
}

export function generateChannelSecretHex(): string {
  return bytesToHex(randomBytes(32))
}

function assertKeyId(keyId: unknown): asserts keyId is string {
  if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) {
    throw new SecureChannelError('channel_protocol', 'invalid channel key id')
  }
}

function readNonce(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length !== NONCE_BYTES * 2 || !HEX_PATTERN.test(value)) {
    throw new SecureChannelError('channel_protocol', 'invalid channel nonce')
  }
  return hexToBytes(value)
}

function readProof(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length !== 64 || !HEX_PATTERN.test(value)) {
    throw new SecureChannelError('channel_protocol', 'invalid channel proof')
  }
  return hexToBytes(value)
}

function readMessage<T extends { type: string }>(raw: unknown, type: T['type']): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new SecureChannelError('channel_protocol', `expected ${type}`)
  const msg = raw as Record<string, unknown>
  if (msg.type !== type) throw new SecureChannelError('channel_protocol', `expected ${type}`)
  if (msg.v !== SECURE_CHANNEL_VERSION) {
    throw new SecureChannelError('channel_protocol', `unsupported channel version ${String(msg.v)}`)
  }
  return msg
}

interface Transcript {
  authKey: Uint8Array
  baseKey: Uint8Array
  keyId: string
  clientNonce: Uint8Array
  serverNonce: Uint8Array
}

function transcriptFor(secretHex: string, keyId: string, clientNonce: Uint8Array, serverNonce: Uint8Array): Transcript {
  const { channelKeyHex, aesKeyBytes } = deriveKeys(secretHex)
  return { authKey: hexToBytes(channelKeyHex), baseKey: aesKeyBytes, keyId, clientNonce, serverNonce }
}

/** HMAC over the role, key id and both nonces; the role label stops reflection. */
function computeProof(t: Transcript, role: 'client' | 'server'): Uint8Array {
  const label = `${LABEL}|${role}|${t.keyId}|${bytesToHex(t.clientNonce)}|${bytesToHex(t.serverNonce)}`
  return hmac(sha256, t.authKey, encoder.encode(label))
}

function directionKey(t: Transcript, direction: 'c2s' | 's2c'): Uint8Array {
  const salt = new Uint8Array(NONCE_BYTES * 2)
  salt.set(t.clientNonce, 0)
  salt.set(t.serverNonce, NONCE_BYTES)
  return hkdf(sha256, t.baseKey, salt, encoder.encode(`${LABEL}|${direction}`), 32)
}

/** Exposed for golden vectors: the two per-connection direction keys. */
export function deriveChannelSessionKeys(
  secretHex: string,
  keyId: string,
  clientNonceHex: string,
  serverNonceHex: string,
): { c2sKeyHex: string; s2cKeyHex: string; clientProofHex: string; serverProofHex: string } {
  const t = transcriptFor(secretHex, keyId, readNonce(clientNonceHex), readNonce(serverNonceHex))
  return {
    c2sKeyHex: bytesToHex(directionKey(t, 'c2s')),
    s2cKeyHex: bytesToHex(directionKey(t, 's2c')),
    clientProofHex: bytesToHex(computeProof(t, 'client')),
    serverProofHex: bytesToHex(computeProof(t, 'server')),
  }
}

/** Client side: send `hello`, then pass the server's challenge to `finish`. */
export function startClientHandshake(
  credential: ChannelCredential,
  clientNonce: Uint8Array = randomBytes(NONCE_BYTES),
): { hello: ChannelHello; finish(challenge: unknown): { proof: ChannelProof; channel: SecureChannel } } {
  assertKeyId(credential.keyId)
  const hello: ChannelHello = {
    type: 'channel_hello',
    v: SECURE_CHANNEL_VERSION,
    keyId: credential.keyId,
    nonce: bytesToHex(clientNonce),
  }
  return {
    hello,
    finish(raw) {
      const msg = readMessage<ChannelChallenge>(raw, 'channel_challenge')
      const t = transcriptFor(credential.secretHex, credential.keyId, clientNonce, readNonce(msg.nonce))
      if (!equalBytes(readProof(msg.proof), computeProof(t, 'server'))) {
        throw new SecureChannelError('channel_auth_failed', 'server did not prove the pairing secret')
      }
      return {
        proof: { type: 'channel_proof', v: SECURE_CHANNEL_VERSION, proof: bytesToHex(computeProof(t, 'client')) },
        channel: new SecureChannel(directionKey(t, 'c2s'), directionKey(t, 's2c')),
      }
    },
  }
}

/**
 * Server side: answer a hello whose key id resolves to a secret, then pass the
 * client's proof to `finish`. An unknown key id fails like a wrong proof.
 */
export function acceptClientHello(
  raw: unknown,
  resolveSecret: (keyId: string) => string | null,
  serverNonce: Uint8Array = randomBytes(NONCE_BYTES),
): { keyId: string; challenge: ChannelChallenge; finish(proof: unknown): SecureChannel } {
  const msg = readMessage<ChannelHello>(raw, 'channel_hello')
  assertKeyId(msg.keyId)
  const keyId = msg.keyId
  const clientNonce = readNonce(msg.nonce)
  const secretHex = resolveSecret(keyId)
  if (!secretHex) throw new SecureChannelError('channel_auth_failed', 'unknown channel key id')
  const t = transcriptFor(secretHex, keyId, clientNonce, serverNonce)
  return {
    keyId,
    challenge: {
      type: 'channel_challenge',
      v: SECURE_CHANNEL_VERSION,
      nonce: bytesToHex(serverNonce),
      proof: bytesToHex(computeProof(t, 'server')),
    },
    finish(rawProof) {
      const proofMsg = readMessage<ChannelProof>(rawProof, 'channel_proof')
      if (!equalBytes(readProof(proofMsg.proof), computeProof(t, 'client'))) {
        throw new SecureChannelError('channel_auth_failed', 'client did not prove the pairing secret')
      }
      return new SecureChannel(directionKey(t, 's2c'), directionKey(t, 'c2s'))
    },
  }
}

/**
 * `IV(12) || AES-256-GCM(seq:u64be || JSON)` with the channel label as AAD.
 * Exposed for golden vectors; use `SecureChannel` otherwise.
 */
export function sealChannelFrame(
  key: Uint8Array,
  seq: number,
  payload: unknown,
  iv: Uint8Array = randomBytes(IV_BYTES),
): Uint8Array {
  const json = encoder.encode(JSON.stringify(payload))
  const plain = new Uint8Array(SEQ_BYTES + json.length)
  new DataView(plain.buffer).setBigUint64(0, BigInt(seq))
  plain.set(json, SEQ_BYTES)
  const sealed = aesGcm().seal(key, iv, plain, AAD)
  const out = new Uint8Array(IV_BYTES + sealed.length)
  out.set(iv, 0)
  out.set(sealed, IV_BYTES)
  return out
}

export function openChannelFrame(key: Uint8Array, frame: Uint8Array): { seq: number; payload: unknown } {
  if (frame.length < IV_BYTES + TAG_BYTES + SEQ_BYTES) {
    throw new SecureChannelError('channel_decrypt', 'channel frame too short')
  }
  let plain: Uint8Array
  try {
    plain = aesGcm().open(key, frame.subarray(0, IV_BYTES), frame.subarray(IV_BYTES), AAD)
  } catch {
    throw new SecureChannelError('channel_decrypt', 'channel frame failed authentication')
  }
  const seq = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getBigUint64(0)
  if (seq > BigInt(Number.MAX_SAFE_INTEGER)) throw new SecureChannelError('channel_replay', 'channel sequence overflow')
  let payload: unknown
  try {
    payload = JSON.parse(decoder.decode(plain.subarray(SEQ_BYTES)))
  } catch {
    throw new SecureChannelError('channel_protocol', 'channel frame is not JSON')
  }
  return { seq: Number(seq), payload }
}

/** One established connection. Sequence numbers start at 1 in each direction. */
export class SecureChannel {
  private sendSeq = 0
  private recvSeq = 0

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
  ) {}

  seal(payload: unknown): Uint8Array {
    this.sendSeq += 1
    return sealChannelFrame(this.sendKey, this.sendSeq, payload)
  }

  /** Throws on tampering, a wrong key, or a sequence number that does not increase. */
  open(frame: Uint8Array): unknown {
    const { seq, payload } = openChannelFrame(this.recvKey, frame)
    if (seq <= this.recvSeq) {
      throw new SecureChannelError('channel_replay', `channel sequence ${seq} after ${this.recvSeq}`)
    }
    this.recvSeq = seq
    return payload
  }
}
