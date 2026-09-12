import QuickCrypto from 'react-native-quick-crypto'
import { fromByteArray, toByteArray } from 'react-native-quick-base64'
import { setCryptoBackend, type AesGcm } from '@superone/relay-client'

const TAG_BYTES = 16

/** A fresh, offset-free copy: quick-base64 hands the native side the whole buffer. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * OpenSSL AES-GCM through react-native-quick-crypto (JSI, synchronous). The
 * pure-JS default seals about 1 MB/s on Hermes and blocks the JS thread doing
 * it, so one attached picture made every relay crossing cost seconds.
 */
const nativeAesGcm: AesGcm = {
  seal(key, iv, plaintext, aad) {
    const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv)
    if (aad) cipher.setAAD(aad as never)
    return concat(cipher.update(plaintext), cipher.final(), cipher.getAuthTag())
  },
  open(key, iv, sealed, aad) {
    if (sealed.byteLength < TAG_BYTES) throw new Error('aes-gcm: sealed data too short')
    const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, iv)
    if (aad) decipher.setAAD(aad as never)
    decipher.setAuthTag(sealed.subarray(sealed.byteLength - TAG_BYTES) as never)
    return concat(decipher.update(sealed.subarray(0, sealed.byteLength - TAG_BYTES)), decipher.final())
  },
}

/** Called once at startup, before the first relay or LAN frame. */
export function installNativeCrypto(): void {
  setCryptoBackend({
    aesGcm: nativeAesGcm,
    base64: { encode: (bytes) => fromByteArray(bytes), decode: (text) => toByteArray(text) },
  })
}
