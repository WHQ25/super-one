import { webcrypto } from 'node:crypto'
import { deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { frameRemotePayload, MAX_REMOTE_PAYLOAD_BYTES } from '@superone/shared/remote-payload'

const deflate = promisify(deflateRaw)

/** Compress before sealing. Worker-pool compression avoids blocking Electron main. */
export async function encryptHostPayload(aesKey: webcrypto.CryptoKey, payload: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  if (json.length > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
  const compressed = json.length > 512 ? await deflate(json) : undefined
  const framed = frameRemotePayload(json, compressed)
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, framed as Uint8Array<ArrayBuffer>)
  return Buffer.concat([iv, new Uint8Array(encrypted)]).toString('base64')
}
