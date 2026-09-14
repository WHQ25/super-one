import { createCipheriv, randomBytes } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { frameRemotePayload } from '@superone/shared/remote-payload'

/** Node reference encoder for mobile transport fixtures, independent of its decoder. */
export function encryptHostTestPayload(key: Uint8Array, payload: unknown): string {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const framed = frameRemotePayload(json, json.length > 512 ? deflateRawSync(json) : undefined)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, cipher.update(framed), cipher.final(), cipher.getAuthTag()]).toString('base64')
}
