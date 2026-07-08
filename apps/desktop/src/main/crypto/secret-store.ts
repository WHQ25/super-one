import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'

export function isEncryptedSecret(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

/**
 * Encrypt a secret for at-rest storage. Returns an `enc:v1:` prefixed base64 blob.
 * Idempotent (already-encrypted input is returned unchanged). Falls back to plaintext
 * when OS encryption is unavailable (e.g. some Linux without a secret service) — this
 * preserves the pre-encryption behavior where the column held a plaintext key.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (isEncryptedSecret(plain)) return plain
  if (!safeStorage.isEncryptionAvailable()) return plain
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

/** Decrypt a stored secret. Plaintext/legacy values are returned as-is. */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (!isEncryptedSecret(stored)) return stored
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}
