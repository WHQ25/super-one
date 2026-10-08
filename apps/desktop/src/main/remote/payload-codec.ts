import { deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { frameRemotePayload, MAX_REMOTE_PAYLOAD_BYTES } from '@superone/shared/remote-payload'

const deflate = promisify(deflateRaw)

/**
 * Host application frame for one payload, compressed once and then sealed per
 * phone connection. Worker-pool compression avoids blocking Electron main.
 */
export async function frameHostPayload(payload: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  if (json.length > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
  const compressed = json.length > 512 ? await deflate(json) : undefined
  return frameRemotePayload(json, compressed)
}
