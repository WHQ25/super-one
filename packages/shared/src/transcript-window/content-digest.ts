/**
 * A 64-bit content digest (two independent 32-bit FNV-1a / murmur-style lanes),
 * fast on Hermes and Node alike. It identifies a fragment body among the few
 * revisions one key goes through, not adversarial input.
 */
export function contentDigest(input: string): string {
  let a = 0x811c9dc5
  let b = 0x9747b28c ^ input.length
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x5bd1e995)
    b ^= b >>> 15
  }
  b = Math.imul(b ^ (b >>> 13), 0xc2b2ae35)
  return (a >>> 0).toString(36).padStart(7, '0') + ((b ^ (b >>> 16)) >>> 0).toString(36).padStart(7, '0')
}

/** UTF-8 length of a string, without encoding it. */
export function utf8Length(input: string): number {
  let bytes = input.length
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code < 0x80) continue
    if (code < 0x800) bytes += 1
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 2; i++ }
    else bytes += 2
  }
  return bytes
}
