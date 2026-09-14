import { inflateSync } from 'fflate'
import { MAX_REMOTE_PAYLOAD_BYTES, REMOTE_PAYLOAD_HEADER_BYTES } from '@superone/shared/remote-payload'

/** The authenticated size fixes the output allocation; one extra byte detects overflow. */
export function decodeHostPlaintext(plain: Uint8Array): unknown {
  if (plain.length < REMOTE_PAYLOAD_HEADER_BYTES || plain.length > MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES) throw new Error('invalid remote payload length')
  const size = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(1)
  if (size > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
  const body = plain.subarray(REMOTE_PAYLOAD_HEADER_BYTES)
  let json: Uint8Array
  if (plain[0] === 0) json = body
  else if (plain[0] === 1) json = inflateSync(body, { out: new Uint8Array(size + 1) })
  else throw new Error('unknown remote payload flag')
  if (json.length !== size) throw new Error('remote payload size mismatch')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
}
