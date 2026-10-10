import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { WireCompression } from '@superone/shared/environment/wire'

/** Node's zlib for the node channel's wire frames, on either end. */
export const nodeWireCompression: WireCompression = {
  deflate: (json, dictionary) => deflateRawSync(json, dictionary ? { dictionary } : {}),
  inflate: (body, out, dictionary) => inflateRawSync(body, { maxOutputLength: out.length, ...(dictionary ? { dictionary } : {}) }),
}
