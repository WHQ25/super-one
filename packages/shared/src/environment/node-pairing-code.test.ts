import { describe, expect, it } from 'vitest'
import {
  NODE_PAIRING_CODE_PREFIX,
  NodePairingCodeError,
  decodeNodePairingCode,
  encodeNodePairingCode,
  type NodePairingCode,
} from './node-pairing-code'

const CODE: NodePairingCode = {
  url: 'http://Studio-Mac.local:7791',
  pairingToken: 'pt_abc.def-123',
  channel: { keyId: 'tok_1', secretHex: 'e4620c0bf60dd8153f5073df3027f93dd7616ff89520dfbc6594907857bf6e6d' },
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

function withPayload(payload: unknown, version = 1): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${NODE_PAIRING_CODE_PREFIX}${version}:${b64}`
}

describe('node pairing code', () => {
  it('round-trips and is URL/QR safe', () => {
    const encoded = encodeNodePairingCode(CODE)
    expect(encoded.startsWith('superone-node:1:')).toBe(true)
    expect(encoded).toMatch(/^[A-Za-z0-9:_-]+$/)
    expect(decodeNodePairingCode(encoded)).toEqual(CODE)
  })

  it('ignores whitespace and line wraps from pasting', () => {
    const encoded = encodeNodePairingCode(CODE)
    const wrapped = `  ${encoded.slice(0, 20)}\n${encoded.slice(20, 50)} \r\n${encoded.slice(50)}\n`
    expect(decodeNodePairingCode(wrapped)).toEqual(CODE)
  })

  it('drops a trailing slash from the url', () => {
    const encoded = encodeNodePairingCode({ ...CODE, url: 'https://node.example.com/' })
    expect(decodeNodePairingCode(encoded).url).toBe('https://node.example.com')
  })

  it('reports expiry only when a clock is given', () => {
    const encoded = encodeNodePairingCode(CODE)
    expect(errorCode(() => decodeNodePairingCode(encoded, CODE.expiresAt))).toBe('expired')
    expect(errorCode(() => decodeNodePairingCode(encoded, CODE.expiresAt - 1))).toBeUndefined()
  })

  it('rejects a newer version distinctly', () => {
    expect(errorCode(() => decodeNodePairingCode(withPayload({}, 2)))).toBe('unsupported_version')
  })

  it.each([
    ['empty', ''],
    ['other scheme', 'superone://pair?channel=x'],
    ['no version', 'superone-node:abc'],
    ['zero version', withPayload({}, 0)],
    ['not base64url', 'superone-node:1:@@@'],
    ['not json', `superone-node:1:${Buffer.from('nope').toString('base64url')}`],
    ['bad url', withPayload({ u: 'ftp://x', t: 't', k: 'k', s: CODE.channel.secretHex, e: 1 })],
    ['missing token', withPayload({ u: CODE.url, t: '', k: 'k', s: CODE.channel.secretHex, e: 1 })],
    ['missing key id', withPayload({ u: CODE.url, t: 't', s: CODE.channel.secretHex, e: 1 })],
    ['short secret', withPayload({ u: CODE.url, t: 't', k: 'k', s: 'abcd', e: 1 })],
    ['missing expiry', withPayload({ u: CODE.url, t: 't', k: 'k', s: CODE.channel.secretHex })],
  ])('rejects %s as invalid', (_name, input) => {
    expect(errorCode(() => decodeNodePairingCode(input))).toBe('invalid')
  })

  it('does not echo the secret in error messages', () => {
    const input = withPayload({ u: 'bad', t: 't', k: 'k', s: CODE.channel.secretHex, e: 1 })
    try {
      decodeNodePairingCode(input)
    } catch (err) {
      expect((err as Error).message).not.toContain(CODE.channel.secretHex)
    }
  })
})
