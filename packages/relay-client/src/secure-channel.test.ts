import { createDecipheriv, createHmac, hkdfSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/ciphers/utils.js'
import {
  SecureChannelError,
  acceptClientHello,
  deriveChannelSessionKeys,
  issueChannelCredential,
  openChannelFrame,
  sealChannelFrame,
  startClientHandshake,
  type ChannelCredential,
} from './secure-channel'

const v = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/secure-channel-vectors.json'), 'utf8'),
) as {
  rootSecretHex: string
  keyId: string
  secretHex: string
  clientNonceHex: string
  serverNonceHex: string
  c2sKeyHex: string
  s2cKeyHex: string
  clientProofHex: string
  serverProofHex: string
  frame: { seq: number; ivHex: string; payload: unknown; frameHex: string }
}

const LABEL = 'superone-channel/v1'
const hkdfHex = (ikm: Buffer, salt: Buffer, info: string) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info), 32)).toString('hex')
const hmacHex = (key: Buffer, data: string) => createHmac('sha256', key).update(data).digest('hex')

function handshake(client: ChannelCredential, resolve: (keyId: string) => string | null) {
  const c = startClientHandshake(client)
  const s = acceptClientHello(JSON.parse(JSON.stringify(c.hello)), resolve)
  const { proof, channel: clientChannel } = c.finish(JSON.parse(JSON.stringify(s.challenge)))
  const serverChannel = s.finish(JSON.parse(JSON.stringify(proof)))
  return { clientChannel, serverChannel }
}

describe('secure channel golden vectors', () => {
  it('derives the frozen secret, proofs and direction keys', () => {
    expect(issueChannelCredential(v.rootSecretHex, v.keyId).secretHex).toBe(v.secretHex)
    expect(deriveChannelSessionKeys(v.secretHex, v.keyId, v.clientNonceHex, v.serverNonceHex)).toEqual({
      c2sKeyHex: v.c2sKeyHex,
      s2cKeyHex: v.s2cKeyHex,
      clientProofHex: v.clientProofHex,
      serverProofHex: v.serverProofHex,
    })
  })

  it('matches an independent node:crypto computation', () => {
    expect(hmacHex(Buffer.from(v.rootSecretHex, 'hex'), `${LABEL}|secret|${v.keyId}`)).toBe(v.secretHex)
    const secret = Buffer.from(v.secretHex, 'hex')
    const channelKey = Buffer.from(hkdfHex(secret, Buffer.alloc(0), 'channel-key'), 'hex')
    const aesKey = Buffer.from(hkdfHex(secret, Buffer.alloc(0), 'aes-key'), 'hex')
    const transcript = `${v.keyId}|${v.clientNonceHex}|${v.serverNonceHex}`
    expect(hmacHex(channelKey, `${LABEL}|client|${transcript}`)).toBe(v.clientProofHex)
    expect(hmacHex(channelKey, `${LABEL}|server|${transcript}`)).toBe(v.serverProofHex)
    const salt = Buffer.from(v.clientNonceHex + v.serverNonceHex, 'hex')
    expect(hkdfHex(aesKey, salt, `${LABEL}|c2s`)).toBe(v.c2sKeyHex)
    expect(hkdfHex(aesKey, salt, `${LABEL}|s2c`)).toBe(v.s2cKeyHex)

    const frame = Buffer.from(v.frame.frameHex, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(v.c2sKeyHex, 'hex'), frame.subarray(0, 12))
    decipher.setAAD(Buffer.from(LABEL))
    decipher.setAuthTag(frame.subarray(frame.length - 16))
    const plain = Buffer.concat([decipher.update(frame.subarray(12, frame.length - 16)), decipher.final()])
    expect(plain.readBigUInt64BE(0)).toBe(BigInt(v.frame.seq))
    expect(JSON.parse(plain.subarray(8).toString('utf8'))).toEqual(v.frame.payload)
  })

  it('seals and opens the frozen frame', () => {
    const key = hexToBytes(v.c2sKeyHex)
    const sealed = sealChannelFrame(key, v.frame.seq, v.frame.payload, hexToBytes(v.frame.ivHex))
    expect(Buffer.from(sealed).toString('hex')).toBe(v.frame.frameHex)
    expect(openChannelFrame(key, hexToBytes(v.frame.frameHex))).toEqual({ seq: v.frame.seq, payload: v.frame.payload })
  })
})

describe('secure channel handshake and frames', () => {
  const cred = issueChannelCredential(v.rootSecretHex, 'client-key-0001')
  const resolve = (keyId: string) => (keyId === cred.keyId ? cred.secretHex : null)

  it('round-trips frames in both directions', () => {
    const { clientChannel, serverChannel } = handshake(cred, resolve)
    expect(serverChannel.open(clientChannel.seal({ a: 1 }))).toEqual({ a: 1 })
    expect(serverChannel.open(clientChannel.seal({ a: 2 }))).toEqual({ a: 2 })
    expect(clientChannel.open(serverChannel.seal('ok'))).toBe('ok')
  })

  it('rejects a replayed or reordered frame', () => {
    const { clientChannel, serverChannel } = handshake(cred, resolve)
    const first = clientChannel.seal({ n: 1 })
    const second = clientChannel.seal({ n: 2 })
    serverChannel.open(second)
    expect(() => serverChannel.open(first)).toThrow(expect.objectContaining({ code: 'channel_replay' }))
    expect(() => serverChannel.open(second)).toThrow(expect.objectContaining({ code: 'channel_replay' }))
  })

  it('rejects a frame from another connection with the same secret', () => {
    const a = handshake(cred, resolve)
    const b = handshake(cred, resolve)
    expect(() => b.serverChannel.open(a.clientChannel.seal({ x: 1 }))).toThrow(
      expect.objectContaining({ code: 'channel_decrypt' }),
    )
  })

  it('rejects a reflected frame', () => {
    const { serverChannel } = handshake(cred, resolve)
    expect(() => serverChannel.open(serverChannel.seal({ x: 1 }))).toThrow(SecureChannelError)
  })

  it('rejects a tampered frame', () => {
    const { clientChannel, serverChannel } = handshake(cred, resolve)
    const frame = clientChannel.seal({ x: 1 })
    frame[frame.length - 20] ^= 0x01
    expect(() => serverChannel.open(frame)).toThrow(expect.objectContaining({ code: 'channel_decrypt' }))
  })

  it('fails the handshake on either side when the secret differs', () => {
    const wrong = { keyId: cred.keyId, secretHex: issueChannelCredential(v.rootSecretHex, 'other-key-0001').secretHex }
    const c = startClientHandshake(wrong)
    const s = acceptClientHello(c.hello, resolve)
    expect(() => c.finish(s.challenge)).toThrow(expect.objectContaining({ code: 'channel_auth_failed' }))

    // A client that skips verification still cannot forge its own proof.
    const forged = { type: 'channel_proof', v: 1, proof: s.challenge.proof }
    expect(() => s.finish(forged)).toThrow(expect.objectContaining({ code: 'channel_auth_failed' }))
  })

  it('fails an unknown key id and malformed messages', () => {
    const c = startClientHandshake(cred)
    expect(() => acceptClientHello(c.hello, () => null)).toThrow(expect.objectContaining({ code: 'channel_auth_failed' }))
    expect(() => acceptClientHello({ ...c.hello, v: 2 }, resolve)).toThrow(expect.objectContaining({ code: 'channel_protocol' }))
    expect(() => acceptClientHello({ ...c.hello, nonce: 'aa' }, resolve)).toThrow(
      expect.objectContaining({ code: 'channel_protocol' }),
    )
    expect(() => acceptClientHello({ ...c.hello, keyId: '../x' }, resolve)).toThrow(
      expect.objectContaining({ code: 'channel_protocol' }),
    )
  })
})
