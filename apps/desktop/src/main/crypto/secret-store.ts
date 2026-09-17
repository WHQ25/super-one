import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'

export function isEncryptedSecret(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

/** Thrown when a secret would otherwise be written in plaintext on a platform that must never do so. */
export class SecureStorageUnavailableError extends Error {
  constructor() {
    super('Secure storage is unavailable: macOS denied access to the keychain. Allow SuperOne in the keychain prompt and try again.')
    this.name = 'SecureStorageUnavailableError'
  }
}

/**
 * Whether a missing OS key store may degrade to plaintext.
 *
 * Linux without a secret service has no better option, and that was the
 * pre-encryption behaviour anyway. On macOS "unavailable" only ever means the
 * user denied the keychain prompt for our item; writing plaintext then would
 * silently downgrade every secret they re-enter, permanently — so the write
 * is refused instead and the caller reports it.
 */
function mayFallBackToPlaintext(): boolean {
  return process.platform !== 'darwin'
}

/**
 * Encrypt a secret for at-rest storage. Returns an `enc:v1:` prefixed base64 blob.
 * Idempotent (already-encrypted input is returned unchanged). Throws
 * `SecureStorageUnavailableError` on macOS when the keychain is unavailable;
 * elsewhere falls back to plaintext.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (isEncryptedSecret(plain)) return plain
  if (!safeStorage.isEncryptionAvailable()) {
    if (mayFallBackToPlaintext()) return plain
    throw new SecureStorageUnavailableError()
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

/**
 * Best-effort variant for data that is already plaintext at rest (legacy
 * migrations): encrypts when possible, otherwise leaves the value as it was.
 * Never a downgrade, since the input was never protected.
 */
export function encryptSecretIfAvailable(plain: string): string {
  try {
    return encryptSecret(plain)
  } catch (err) {
    if (err instanceof SecureStorageUnavailableError) return plain
    throw err
  }
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
