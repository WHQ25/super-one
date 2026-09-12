import { gcm } from '@noble/ciphers/aes.js'

/**
 * The two primitives every relay frame goes through, and the only ones worth
 * making native. Pure-JS AES-GCM (`@noble/ciphers`) runs at roughly 1 MB/s on
 * Hermes and blocks the JS thread while it does, so a picture attached to a
 * message costs seconds per crossing; the phone installs an OpenSSL-backed
 * implementation at startup (`apps/mobile/src/native-crypto.ts`). Tests and
 * Node keep the default.
 */
export interface AesGcm {
  /** Returns ciphertext followed by the 16-byte tag, as WebCrypto and noble do. */
  seal(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array
  /** Takes ciphertext followed by the tag; throws on a bad tag. */
  open(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array
}

export interface Base64Codec {
  encode(bytes: Uint8Array): string
  decode(text: string): Uint8Array
}

export interface CryptoBackend {
  aesGcm?: AesGcm
  base64?: Base64Codec
}

export const nobleAesGcm: AesGcm = {
  seal: (key, iv, plaintext, aad) => gcm(key, iv, aad).encrypt(plaintext),
  open: (key, iv, sealed, aad) => gcm(key, iv, aad).decrypt(sealed),
}

export const jsBase64: Base64Codec = {
  encode(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
    // Chunked apply: a per-byte concatenation is ~10× slower on Hermes.
    const parts: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192) as unknown as number[]))
    }
    return btoa(parts.join(''))
  },
  decode(text) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'))
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  },
}

let backend: Required<CryptoBackend> = { aesGcm: nobleAesGcm, base64: jsBase64 }

/** Swap in native primitives; a missing field keeps the JS default. */
export function setCryptoBackend(next: CryptoBackend | null): void {
  backend = { aesGcm: next?.aesGcm ?? nobleAesGcm, base64: next?.base64 ?? jsBase64 }
}

export function aesGcm(): AesGcm {
  return backend.aesGcm
}

export function base64(): Base64Codec {
  return backend.base64
}
