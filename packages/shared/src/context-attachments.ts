/** Generic presentation shared by composer context, confirmation cards and message bubbles. */
export interface ContextAttachment {
  id: string
  title: string
  source?: string
  content?: string
  thumbnail?: string
}

/** Plain UTF-8 preview without splitting a multibyte character. */
export function contextAttachmentPreview(text: string, maxBytes = 4096): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes - 3)).replace(/\uFFFD$/, '') + '…'
}
