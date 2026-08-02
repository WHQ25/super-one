/**
 * At-rest encryption for provider secrets on the node (no Electron safeStorage).
 * AES-256-GCM with a per-node key file under secrets/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ENC_PREFIX = 'enc:v1:'
const KEY_BYTES = 32

export function isEncryptedSecret(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

function ensureKeyFile(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath)
    if (raw.length === KEY_BYTES) return raw
  }
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
  const key = randomBytes(KEY_BYTES)
  writeFileSync(keyPath, key, { mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    /* best-effort */
  }
  return key
}

export function createNodeSecretCrypto(keyPath: string): {
  encrypt(plain: string): string
  decrypt(stored: string): string
} {
  const key = ensureKeyFile(keyPath)
  return {
    encrypt(plain: string): string {
      if (!plain) return ''
      if (isEncryptedSecret(plain)) return plain
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64')
    },
    decrypt(stored: string): string {
      if (!stored) return ''
      if (!isEncryptedSecret(stored)) return stored
      try {
        const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
        const iv = buf.subarray(0, 12)
        const tag = buf.subarray(12, 28)
        const data = buf.subarray(28)
        const decipher = createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
      } catch {
        return ''
      }
    },
  }
}
