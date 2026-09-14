/** Application plaintext framing; pairing and chunked file crypto are separate. */
export const REMOTE_PAYLOAD_HEADER_BYTES = 5
export const MAX_REMOTE_PAYLOAD_BYTES = 32 * 1024 * 1024

// AES-GCM IV/tag plus the authenticated plaintext header, base64 encoded.
export const MAX_REMOTE_CIPHERTEXT_CHARS = Math.ceil((MAX_REMOTE_PAYLOAD_BYTES + REMOTE_PAYLOAD_HEADER_BYTES + 28) / 3) * 4
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
