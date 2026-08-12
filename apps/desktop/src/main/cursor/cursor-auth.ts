import { decryptSecret, encryptSecret } from '../crypto/secret-store'
export {
  readCursorConfig,
  mapPermissionToCursorLocal,
  buildCloudOptions,
  type CursorConfig,
  type CursorCloudRepoConfig,
} from '@superone/cursor'
import { readCursorConfig, resolveCursorApiKeyPlain } from '@superone/cursor'

/**
 * Resolve Cursor User API Key: decrypt stored secret → plaintext/env fallback.
 */
export function resolveCursorApiKey(config: unknown): string | undefined {
  const cfg = readCursorConfig(config)
  if (cfg.apiKey?.trim()) {
    const decrypted = decryptSecret(cfg.apiKey.trim())
    if (decrypted) return decrypted
  }
  return resolveCursorApiKeyPlain(config)
}

/** Encrypt a Cursor API key for at-rest storage. */
export function encryptCursorApiKey(plain: string): string {
  return encryptSecret(plain)
}
