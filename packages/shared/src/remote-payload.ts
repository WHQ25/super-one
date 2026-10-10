/** Application plaintext framing; pairing and chunked file crypto are separate. */
export const REMOTE_PAYLOAD_HEADER_BYTES = 5
export const MAX_REMOTE_PAYLOAD_BYTES = 32 * 1024 * 1024

/** Bound on the authenticated link header that precedes a host frame (relay-client `phone-link.ts`). */
export const REMOTE_LINK_HEADER_MAX_BYTES = 1024
// Channel IV, tag and sequence number, the link header with its u16 length, and
// the host frame header, base64 encoded.
export const MAX_REMOTE_CIPHERTEXT_CHARS = Math.ceil(
  (MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES + 12 + 16 + 8 + 2 + REMOTE_LINK_HEADER_MAX_BYTES) / 3,
) * 4
export const REMOTE_RESPONSE_CHUNK_CHARS = 800_000

export function frameRemotePayload(json: Uint8Array, compressed?: Uint8Array): Uint8Array {
  if (json.length > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
  const body = compressed && compressed.length < json.length ? compressed : json
  const framed = new Uint8Array(REMOTE_PAYLOAD_HEADER_BYTES + body.length)
  framed[0] = body === json ? 0 : 1
  new DataView(framed.buffer).setUint32(1, json.length)
  framed.set(body, REMOTE_PAYLOAD_HEADER_BYTES)
  return framed
}

/** Inflates raw DEFLATE into a buffer of the authenticated `size` (+1 byte to detect overflow). */
export type RemotePayloadInflate = (body: Uint8Array, out: Uint8Array) => Uint8Array

/** The JSON value of a framed payload; the authenticated size fixes the output allocation. */
export function decodeRemotePayload(plain: Uint8Array, inflate: RemotePayloadInflate): unknown {
  if (plain.length < REMOTE_PAYLOAD_HEADER_BYTES || plain.length > MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES) throw new Error('invalid remote payload length')
  const size = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(1)
  if (size > MAX_REMOTE_PAYLOAD_BYTES) throw new Error('remote payload exceeds 32 MiB')
  const body = plain.subarray(REMOTE_PAYLOAD_HEADER_BYTES)
  let json: Uint8Array
  if (plain[0] === 0) json = body
  else if (plain[0] === 1) json = inflate(body, new Uint8Array(size + 1))
  else throw new Error('unknown remote payload flag')
  if (json.length !== size) throw new Error('remote payload size mismatch')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
}
