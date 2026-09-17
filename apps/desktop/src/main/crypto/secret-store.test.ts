import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
  decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc\((.*)\)$/, '$1')),
}))
vi.mock('electron', () => ({ safeStorage }))

import { decryptSecret, encryptSecret, encryptSecretIfAvailable, SecureStorageUnavailableError } from './secret-store'

const platform = process.platform
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })

describe('secret-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    safeStorage.isEncryptionAvailable.mockReturnValue(true)
  })
  afterEach(() => setPlatform(platform))

  it('round-trips through the OS key store', () => {
    const stored = encryptSecret('sk-live')
    expect(stored.startsWith('enc:v1:')).toBe(true)
    expect(decryptSecret(stored)).toBe('sk-live')
  })

  it('refuses to downgrade to plaintext on macOS when the keychain is denied', () => {
    // After the bundle-id migration the first launch may hit a denied keychain
    // prompt. Falling back to plaintext there would re-save every key the
    // user re-enters unprotected, forever — so the write fails loudly instead.
    setPlatform('darwin')
    safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(() => encryptSecret('sk-live')).toThrow(SecureStorageUnavailableError)
    // Reads degrade to "empty", never to garbage.
    expect(decryptSecret('enc:v1:AAAA')).toBe('')
  })

  it('still falls back to plaintext where no key store exists at all', () => {
    setPlatform('linux')
    safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(encryptSecret('sk-live')).toBe('sk-live')
  })

  it('keeps legacy plaintext as-is when it cannot be upgraded', () => {
    setPlatform('darwin')
    safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(encryptSecretIfAvailable('legacy-plain')).toBe('legacy-plain')
    safeStorage.isEncryptionAvailable.mockReturnValue(true)
    expect(encryptSecretIfAvailable('legacy-plain').startsWith('enc:v1:')).toBe(true)
  })
})
