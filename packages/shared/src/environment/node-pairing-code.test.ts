import { describe, expect, it } from 'vitest'
import {
  NODE_PAIRING_CODE_PREFIX,
  NodePairingCodeError,
  decodeNodePairingCode,
  encodeNodePairingCode,
  nodePairingCodeLabel,
  nodePairingEndpointProfiles,
  type NodePairingCode,
} from './node-pairing-code'

const SECRET = 'e4620c0bf60dd8153f5073df3027f93dd7616ff89520dfbc6594907857bf6e6d'
const ROOM = '0f'.repeat(16)

const CODE: NodePairingCode = {
  environmentId: 'env_studio',
  lan: { host: 'Studio-Mac.local', port: 7791 },
  tailscaleHost: '100.101.102.103',
  relay: { url: 'wss://relay.example.com', room: ROOM },
  pairingToken: 'pt_abc.def-123',
  channel: { keyId: 'tok_1', secretHex: SECRET },
  expiresAt: 1_800_000_000_000,
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof NodePairingCodeError ? err.code : 'not-a-pairing-error'
  }
  return undefined
}

function withPayload(payload: unknown, version = 2): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${NODE_PAIRING_CODE_PREFIX}${version}:${b64}`
}

const BASE = { n: 'env', l: { h: 'Studio.local', p: 7791 }, t: 't', k: 'k', s: SECRET, e: 1 }

describe('node pairing code', () => {
  it('round-trips and is URL/QR safe', () => {
    const encoded = encodeNodePairingCode(CODE)
    expect(encoded.startsWith('superone-node:2:')).toBe(true)
    expect(encoded).toMatch(/^[A-Za-z0-9:_-]+$/)
    expect(decodeNodePairingCode(encoded)).toEqual(CODE)
  })

  it('accepts a relay-only or a LAN-only code', () => {
    const relayOnly: NodePairingCode = { ...CODE, lan: undefined, tailscaleHost: undefined }
    delete relayOnly.lan
    delete relayOnly.tailscaleHost
    expect(decodeNodePairingCode(encodeNodePairingCode(relayOnly))).toEqual(relayOnly)
    const lanOnly: NodePairingCode = { ...CODE }
    delete lanOnly.relay
    expect(decodeNodePairingCode(encodeNodePairingCode(lanOnly))).toEqual(lanOnly)
  })

  it('ignores whitespace and line wraps from pasting', () => {
    const encoded = encodeNodePairingCode(CODE)
    const wrapped = `  ${encoded.slice(0, 20)}\n${encoded.slice(20, 50)} \r\n${encoded.slice(50)}\n`
    expect(decodeNodePairingCode(wrapped)).toEqual(CODE)
  })

  it('drops a trailing slash from the relay url', () => {
    const encoded = encodeNodePairingCode({ ...CODE, relay: { url: 'wss://relay.example.com/', room: ROOM } })
    expect(decodeNodePairingCode(encoded).relay?.url).toBe('wss://relay.example.com')
  })

  it('reports expiry only when a clock is given', () => {
    const encoded = encodeNodePairingCode(CODE)
    expect(errorCode(() => decodeNodePairingCode(encoded, CODE.expiresAt))).toBe('expired')
    expect(errorCode(() => decodeNodePairingCode(encoded, CODE.expiresAt - 1))).toBeUndefined()
  })

  it('rejects other versions distinctly', () => {
    expect(errorCode(() => decodeNodePairingCode(withPayload(BASE, 1)))).toBe('unsupported_version')
    expect(errorCode(() => decodeNodePairingCode(withPayload(BASE, 3)))).toBe('unsupported_version')
  })

  it.each([
    ['empty', ''],
    ['other scheme', 'superone://pair?channel=x'],
    ['no version', 'superone-node:abc'],
    ['zero version', withPayload({}, 0)],
    ['not base64url', 'superone-node:2:@@@'],
    ['not json', `superone-node:2:${Buffer.from('nope').toString('base64url')}`],
    ['missing environment', withPayload({ ...BASE, n: '' })],
    ['no route', withPayload({ ...BASE, l: undefined })],
    ['bad lan port', withPayload({ ...BASE, l: { h: 'x', p: 0 } })],
    ['bad lan host', withPayload({ ...BASE, l: { h: 'a b', p: 1 } })],
    ['bad relay url', withPayload({ ...BASE, r: { u: 'https://relay', m: ROOM } })],
    ['bad relay room', withPayload({ ...BASE, r: { u: 'wss://relay', m: 'room' } })],
    ['missing token', withPayload({ ...BASE, t: '' })],
    ['missing key id', withPayload({ ...BASE, k: undefined })],
    ['short secret', withPayload({ ...BASE, s: 'abcd' })],
    ['missing expiry', withPayload({ ...BASE, e: undefined })],
  ])('rejects %s as invalid', (_name, input) => {
    expect(errorCode(() => decodeNodePairingCode(input))).toBe('invalid')
  })

  it('does not echo the secret in error messages', () => {
    const input = withPayload({ ...BASE, l: { h: 'bad host', p: 1 } })
    try {
      decodeNodePairingCode(input)
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET)
    }
  })

  it('turns the routes into endpoint profiles, LAN first and relay last', () => {
    expect(nodePairingEndpointProfiles(CODE)).toEqual([
      { endpointId: 'lan', kind: 'direct-wss', label: 'Studio-Mac.local', target: 'http://Studio-Mac.local:7791' },
      { endpointId: 'tailscale', kind: 'tailscale', label: 'Tailscale 100.101.102.103', target: 'http://100.101.102.103:7791' },
      { endpointId: 'relay', kind: 'relay', label: 'Relay', target: 'wss://relay.example.com', relay: { roomId: ROOM } },
    ])
    expect(nodePairingCodeLabel(CODE)).toBe('Studio-Mac')
  })
})
