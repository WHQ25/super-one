import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/ciphers/utils.js'
import { REMOTE_LINK_HEADER_MAX_BYTES } from '@superone/shared/remote-payload'
import { decodeLinkBody, encodeLinkBody, openLinkFrame, sealLinkFrame } from './phone-link'
import { acceptClientHello, issueChannelCredential, openChannelBytes, sealChannelBytes, startClientHandshake } from './secure-channel'

const v = JSON.parse(readFileSync(new URL('./fixtures/secure-channel-vectors.json', import.meta.url), 'utf8')) as {
  s2cKeyHex: string
  linkFrame: { seq: number; ivHex: string; header: { t: 'response'; requestId: string }; hostFrameHex: string; payload: unknown; frameHex: string }
}

function pair() {
  const credential = issueChannelCredential('ab'.repeat(32), 'phone-key-0001')
  const c = startClientHandshake(credential)
  const s = acceptClientHello(c.hello, () => credential.secretHex)
  const { proof, channel: phone } = c.finish(s.challenge)
  return { phone, host: s.finish(proof) }
}

describe('phone link golden vector', () => {
  it('seals the frozen link frame', () => {
    const body = encodeLinkBody(v.linkFrame.header as never, hexToBytes(v.linkFrame.hostFrameHex))
    const sealed = sealChannelBytes(hexToBytes(v.s2cKeyHex), v.linkFrame.seq, body, hexToBytes(v.linkFrame.ivHex))
    expect(Buffer.from(sealed).toString('hex')).toBe(v.linkFrame.frameHex)
    const opened = openChannelBytes(hexToBytes(v.s2cKeyHex), hexToBytes(v.linkFrame.frameHex))
    expect(opened.seq).toBe(v.linkFrame.seq)
    expect(opened.body).toEqual(body)
    // Historical crypto vectors stay frozen; their retired application header is refused.
    expect(() => decodeLinkBody(opened.body)).toThrow('invalid link header')
  })

  it('matches an independent node:crypto reading', () => {
    const frame = Buffer.from(v.linkFrame.frameHex, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(v.s2cKeyHex, 'hex'), frame.subarray(0, 12))
    decipher.setAAD(Buffer.from('superone-channel/v1'))
    decipher.setAuthTag(frame.subarray(frame.length - 16))
    const plain = Buffer.concat([decipher.update(frame.subarray(12, frame.length - 16)), decipher.final()])
    expect(plain.readBigUInt64BE(0)).toBe(BigInt(v.linkFrame.seq))
    const headerLength = plain.readUInt16BE(8)
    expect(JSON.parse(plain.subarray(10, 10 + headerLength).toString('utf8'))).toEqual(v.linkFrame.header)
    expect(plain.subarray(10 + headerLength).toString('hex')).toBe(v.linkFrame.hostFrameHex)
  })
})

describe('phone link frames', () => {
  it('round-trips headers and payloads in both directions', () => {
    const { phone, host } = pair()
    const command = new TextEncoder().encode('{"type":"rpc","method":"project.list"}')
    expect(openLinkFrame(phone, sealLinkFrame(host, { t: 'rpc' }, command))).toEqual({ header: { t: 'rpc' }, payload: command })
    expect(openLinkFrame(host, sealLinkFrame(phone, { t: 'rpc' }, command))).toEqual({ header: { t: 'rpc' }, payload: command })
    const opened = openLinkFrame(phone, sealLinkFrame(host, { t: 'handshake', hostName: 'Mac', lan: { hosts: ['10.0.0.2'], port: 7788 } }))
    expect(opened.header).toEqual({ t: 'handshake', hostName: 'Mac', lan: { hosts: ['10.0.0.2'], port: 7788 } })
    const info = { appVersion: '0.60.0', protocol: 3, environmentId: 'env-1' }
    expect(openLinkFrame(phone, sealLinkFrame(host, { t: 'handshake', hostName: 'Mac', host: info })).header)
      .toEqual({ t: 'handshake', hostName: 'Mac', host: info })
    // A malformed `host` reads as a host that did not say.
    expect(decodeLinkBody(encodeLinkBody({ t: 'handshake', hostName: 'Mac', host: { appVersion: 1 } } as never)).header)
      .toEqual({ t: 'handshake', hostName: 'Mac' })
  })

  it('rejects replayed, tampered and cross-direction frames', () => {
    const { phone, host } = pair()
    const frame = sealLinkFrame(host, { t: 'rpc' })
    openLinkFrame(phone, frame)
    expect(() => openLinkFrame(phone, frame)).toThrow(expect.objectContaining({ code: 'channel_replay' }))
    const tampered = Buffer.from(sealLinkFrame(host, { t: 'rpc' }), 'base64')
    tampered[tampered.length - 1] ^= 1
    expect(() => openLinkFrame(phone, tampered.toString('base64'))).toThrow(expect.objectContaining({ code: 'channel_decrypt' }))
    expect(() => openLinkFrame(host, sealLinkFrame(host, { t: 'rpc' }))).toThrow(expect.objectContaining({ code: 'channel_decrypt' }))
  })

  it('rejects unknown kinds and oversized or malformed headers', () => {
    expect(() => decodeLinkBody(encodeLinkBody({ t: 'nope' } as never))).toThrow('invalid link header')
    for (const t of ['command', 'event', 'terminal', 'response']) expect(() => decodeLinkBody(encodeLinkBody({ t, requestId: 'old' } as never))).toThrow('invalid link header')
    expect(() => encodeLinkBody({ t: 'handshake', hostName: 'x'.repeat(REMOTE_LINK_HEADER_MAX_BYTES) })).toThrow('too large')
    const lying = encodeLinkBody({ t: 'rpc' })
    new DataView(lying.buffer).setUint16(0, 500)
    expect(() => decodeLinkBody(lying)).toThrow('header length')
    expect(() => decodeLinkBody(new Uint8Array([0]))).toThrow('too short')
  })
})
