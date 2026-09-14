/** Portable turn admission policy, shared by composers and host adapters. */
export const MAX_ATTACHMENT_BYTES = 4_000_000
export const MAX_TURN_ATTACHMENTS = 8
export const MAX_TURN_ATTACHMENT_BYTES = 12_000_000
export const MAX_ATTACHMENT_TURN_JSON_BYTES = 20_000_000

export interface AttachmentData {
  name?: string
  mimeType: string
  base64: string
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(`Attachment: ${message}`)
    this.name = 'AttachmentError'
  }
}

export function attachmentBase64(value: string): string {
  return value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
}

/** Decode only the signature; avoid allocating whole images on the UI thread. */
function signature(raw: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes: number[] = []
  let bits = 0, value = 0
  for (const char of raw.slice(0, 16)) {
    const digit = alphabet.indexOf(char)
    if (digit < 0) break
    value = (value << 6) | digit
    bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
  }
  return bytes
}

export function validateTurnAttachments(attachments: readonly AttachmentData[] = [], text = ''): void {
  if (attachments.length > MAX_TURN_ATTACHMENTS) throw new AttachmentError(`Attach at most ${MAX_TURN_ATTACHMENTS} files per message.`)
  let total = 0
  for (const attachment of attachments) {
    const label = attachment.name || 'Attachment'
    const raw = attachmentBase64(attachment.base64)
    if (raw.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw new AttachmentError(`${label} exceeds the 4 MB attachment limit.`)
    if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new AttachmentError(`${label} has invalid base64 data.`)
    const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const last = alphabet.indexOf(raw[raw.length - padding - 1]!)
    if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) throw new AttachmentError(`${label} has invalid base64 padding.`)
    const size = raw.length / 4 * 3 - padding
    if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${label} exceeds the 4 MB attachment limit.`)
    total += size
    const bytes = signature(raw)
    const starts = (...prefix: number[]) => prefix.every((v, i) => bytes[i] === v)
    const mime = starts(137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png'
      : starts(255, 216, 255) ? 'image/jpeg'
      : starts(71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97 ? 'image/gif'
      : starts(82, 73, 70, 70) && bytes.slice(8, 12).join(',') === '87,69,66,80' ? 'image/webp'
      : starts(37, 80, 68, 70, 45) ? 'application/pdf' : null
    if (!mime || mime !== attachment.mimeType) throw new AttachmentError(`${label} must contain valid JPEG, PNG, GIF, WebP or PDF data matching its MIME type.`)
  }
  if (total > MAX_TURN_ATTACHMENT_BYTES) throw new AttachmentError('Attachments exceed the 12 MB total per message.')
  if (attachments.length && new TextEncoder().encode(JSON.stringify({ text, attachments })).length > MAX_ATTACHMENT_TURN_JSON_BYTES) {
    throw new AttachmentError('The message and attachments exceed the 20 MB request limit.')
  }
}
