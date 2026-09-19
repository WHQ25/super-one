import { getDb, maskApiKey } from '../database'
import { decryptSecret, encryptSecret } from '../crypto/secret-store'

/**
 * The TypeSafe (Jev) API key for the experimental browser fast loop.
 *
 * Kept in `app_meta`, encrypted with the OS key store, and never copied into
 * `AppSettings`: that object is broadcast to every renderer window, and the
 * only reader of the plaintext is the main-process TypeSafe client.
 */
const META_KEY = 'jev.apiKey'

export interface JevApiKeyStatus {
  configured: boolean
  /** `***last6` when configured, empty otherwise — the renderer never sees more. */
  masked: string
}

export function getJevApiKey(): string {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEY) as { value?: string } | undefined
  return row?.value ? decryptSecret(row.value) : ''
}

export function hasJevApiKey(): boolean {
  return getJevApiKey().length > 0
}

export function getJevApiKeyStatus(): JevApiKeyStatus {
  const key = getJevApiKey()
  return { configured: key.length > 0, masked: key ? maskApiKey(key) : '' }
}

/** Store (or clear, with an empty string) the key. Throws when secure storage is refused. */
export function setJevApiKey(key: string): JevApiKeyStatus {
  const trimmed = key.trim()
  const db = getDb()
  if (!trimmed) {
    db.prepare('DELETE FROM app_meta WHERE key = ?').run(META_KEY)
  } else {
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(META_KEY, encryptSecret(trimmed))
  }
  return getJevApiKeyStatus()
}
