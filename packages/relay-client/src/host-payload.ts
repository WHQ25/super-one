import { inflateSync } from 'fflate'
import { decodeRemotePayload } from '@superone/shared/remote-payload'

export function decodeHostPlaintext(plain: Uint8Array): unknown {
  return decodeRemotePayload(plain, (body, out) => inflateSync(body, { out }))
}
