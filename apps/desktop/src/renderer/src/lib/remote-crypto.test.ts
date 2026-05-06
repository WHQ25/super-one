import { generateNonce, deriveKeys, encryptPayload, decryptPayload, computeSignature } from './remote-crypto'

describe('generateNonce', () => {
  it('should return a 6-character hex string', () => {
    const nonce = generateNonce()
    expect(nonce).toHaveLength(6)
    expect(nonce).toMatch(/^[0-9a-f]{6}$/)
  })

  it('should return unique values on consecutive calls', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()))
    expect(nonces.size).toBeGreaterThan(1)
  })
})

describe('deriveKeys', () => {
  const masterSecret = 'ab'.repeat(16)

  it('should return channelKeyHex as 64-char hex and a CryptoKey', async () => {
    const { channelKeyHex, aesKey } = await deriveKeys(masterSecret)
    expect(channelKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(aesKey).toBeDefined()
    expect(aesKey.algorithm).toMatchObject({ name: 'AES-GCM' })
  })

  it('should be deterministic for the same master secret', async () => {
    const a = await deriveKeys(masterSecret)
    const b = await deriveKeys(masterSecret)
    expect(a.channelKeyHex).toBe(b.channelKeyHex)
  })

  it('should produce different keys for different secrets', async () => {
    const a = await deriveKeys('aa'.repeat(16))
    const b = await deriveKeys('bb'.repeat(16))
    expect(a.channelKeyHex).not.toBe(b.channelKeyHex)
  })
})

describe('encryptPayload / decryptPayload', () => {
  let aesKey: CryptoKey

  beforeAll(async () => {
    ;({ aesKey } = await deriveKeys('cc'.repeat(16)))
  })

  it('should round-trip a JSON-serializable payload', async () => {
    const payload = { hello: 'world', n: 42, nested: [1, 2, 3] }
    const encrypted = await encryptPayload(aesKey, payload)
    const decrypted = await decryptPayload(aesKey, encrypted)
    expect(decrypted).toEqual(payload)
  })

  it('should return a base64 string', async () => {
    const encrypted = await encryptPayload(aesKey, 'test')
    expect(() => atob(encrypted)).not.toThrow()
  })

  it('should produce different ciphertexts for the same plaintext (random IV)', async () => {
    const a = await encryptPayload(aesKey, 'same')
    const b = await encryptPayload(aesKey, 'same')
    expect(a).not.toBe(b)
  })

  it('should fail to decrypt with a different key', async () => {
    const { aesKey: otherKey } = await deriveKeys('dd'.repeat(16))
    const encrypted = await encryptPayload(aesKey, 'secret')
    await expect(decryptPayload(otherKey, encrypted)).rejects.toThrow()
  })
})

describe('computeSignature', () => {
  it('should return a 40-char hex string (SHA-1)', async () => {
    const sig = await computeSignature(1234567890, 'abc123', 'ff'.repeat(32))
    expect(sig).toMatch(/^[0-9a-f]{40}$/)
  })

  it('should be deterministic', async () => {
    const a = await computeSignature(100, 'nonce', 'aa'.repeat(32))
    const b = await computeSignature(100, 'nonce', 'aa'.repeat(32))
    expect(a).toBe(b)
  })

  it('should differ when any input changes', async () => {
    const base = await computeSignature(100, 'nonce', 'aa'.repeat(32))
    const diffTs = await computeSignature(101, 'nonce', 'aa'.repeat(32))
    const diffNonce = await computeSignature(100, 'other', 'aa'.repeat(32))
    const diffKey = await computeSignature(100, 'nonce', 'bb'.repeat(32))
    expect(base).not.toBe(diffTs)
    expect(base).not.toBe(diffNonce)
    expect(base).not.toBe(diffKey)
  })
})
