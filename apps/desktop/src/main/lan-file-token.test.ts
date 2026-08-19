import { webcrypto } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import {
  createLanFileTokenSigner,
  deriveFileTokenKey,
  deriveFileTokenKeyFromExtractable,
} from './lan-file-token'

async function makeAesKey(seedHex: string): Promise<webcrypto.CryptoKey> {
  const bytes = Uint8Array.from(seedHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return webcrypto.subtle.importKey('raw', bytes, 'AES-GCM', true, ['encrypt', 'decrypt'])
}

const SEED_A = 'a'.repeat(64)
const SEED_B = 'b'.repeat(64)

describe('lan-file-token', () => {
  let signerA: ReturnType<typeof createLanFileTokenSigner>
  let signerB: ReturnType<typeof createLanFileTokenSigner>

  beforeAll(async () => {
    const aes = await makeAesKey(SEED_A)
    const hmac = await deriveFileTokenKey(aes)
    signerA = createLanFileTokenSigner(hmac)

    const otherHmac = await deriveFileTokenKeyFromExtractable(SEED_B)
    signerB = createLanFileTokenSigner(otherHmac)
  })

  it('sign then verify yields the original path', async () => {
    const token = await signerA.sign('/some/file.png')
    const payload = await signerA.verify(token)
    expect(payload).not.toBeNull()
    expect(payload!.path).toBe('/some/file.png')
    expect(payload!.expiresAt).toBeGreaterThan(Date.now())
    expect(payload!.nonce).toMatch(/^[0-9a-f]{16}$/)
  })

  it('different signs of the same path produce different tokens (nonce)', async () => {
    const t1 = await signerA.sign('/x.png')
    const t2 = await signerA.sign('/x.png')
    expect(t1).not.toBe(t2)
  })

  it('rejects expired token', async () => {
    const past = Date.now() - 10_000
    const token = await signerA.sign('/x.png', { now: past, ttlMs: 1_000 })
    const payload = await signerA.verify(token)
    expect(payload).toBeNull()
  })

  it('accepts token at the exact verification instant', async () => {
    const baseNow = 1_000_000_000_000
    const token = await signerA.sign('/x.png', { now: baseNow, ttlMs: 60_000 })
    expect(await signerA.verify(token, { now: baseNow + 30_000 })).not.toBeNull()
  })

  it('rejects token signed by a different key', async () => {
    const token = await signerA.sign('/x.png')
    const payload = await signerB.verify(token)
    expect(payload).toBeNull()
  })

  it('rejects token with tampered payload', async () => {
    const token = await signerA.sign('/x.png')
    const dot = token.lastIndexOf('.')
    const tampered = token.slice(0, dot - 1) + token.slice(dot)
    expect(await signerA.verify(tampered)).toBeNull()
  })

  it('rejects token with tampered signature', async () => {
    const token = await signerA.sign('/x.png')
    // Mutate the signature's FIRST base64url char, not its last: HMAC-SHA256 is
    // 32 bytes, so the trailing char carries only 4 significant bits and its
    // low 2 padding bits decode to nothing. Flipping those yields the same HMAC
    // bytes and still verifies — a ~1/16 flake depending on the random nonce.
    const sigStart = token.lastIndexOf('.') + 1
    const tampered =
      token.slice(0, sigStart) + (token[sigStart] === 'A' ? 'B' : 'A') + token.slice(sigStart + 1)
    expect(tampered).not.toBe(token)
    expect(await signerA.verify(tampered)).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await signerA.verify('')).toBeNull()
    expect(await signerA.verify('no-dot-here')).toBeNull()
    expect(await signerA.verify('.only-sig')).toBeNull()
    expect(await signerA.verify('only-payload.')).toBeNull()
    expect(await signerA.verify('garbage.token.parts')).toBeNull()
  })

  it('two independent signers derived from same secret agree', async () => {
    const aes1 = await makeAesKey(SEED_A)
    const aes2 = await makeAesKey(SEED_A)
    const k1 = await deriveFileTokenKey(aes1)
    const k2 = await deriveFileTokenKey(aes2)
    const sA = createLanFileTokenSigner(k1)
    const sB = createLanFileTokenSigner(k2)
    const token = await sA.sign('/p.png')
    expect(await sB.verify(token)).not.toBeNull()
  })
})
