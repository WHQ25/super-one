import { createRequire } from 'module'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'

const requireElectron = createRequire(import.meta.url)

/** Longest side of the thumbnail a phone's transcript carries for a picture. */
export const ATTACHMENT_THUMBNAIL_MAX_SIDE = 256
const THUMBNAIL_JPEG_QUALITY = 70
const THUMBNAIL_CACHE_LIMIT = 256

/** A thumbnail as it replaces the attachment's bytes on the wire. */
export interface AttachmentThumbnail {
  base64: string
  mimeType: string
}

/** Produce the thumbnail for one picture, or `null` when the bytes cannot be decoded. */
export type ThumbnailEncoder = (bytes: Buffer, mimeType: string) => AttachmentThumbnail | null

interface ThumbnailNativeImage {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: (opts: { width: number; height: number; quality?: string }) => ThumbnailNativeImage
  toJPEG: (quality: number) => Buffer
}

/**
 * Electron's own decoder: PNG and JPEG only, which is what the phone sends
 * (`chat-image-encoding.ts`) and what desktop pastes. A GIF or WebP comes back
 * `null` and travels as an icon chip until opened.
 */
function nativeEncoder(): ThumbnailEncoder {
  // Lazy so unit tests can run the projection without loading Electron.
  const { nativeImage } = requireElectron('electron') as typeof import('electron')
  return (bytes) => {
    const image = nativeImage.createFromBuffer(bytes) as unknown as ThumbnailNativeImage
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const scale = Math.min(1, ATTACHMENT_THUMBNAIL_MAX_SIDE / Math.max(width, height, 1))
    const small = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
      : image
    return { base64: small.toJPEG(THUMBNAIL_JPEG_QUALITY).toString('base64'), mimeType: 'image/jpeg' }
  }
}

let defaultEncoder: ThumbnailEncoder | null = null

/**
 * Thumbnails already cut, keyed by attachment identity and size. History is
 * re-sent on every open, page and reconnect; the picture never changes.
 */
const cache = new Map<string, AttachmentThumbnail | null>()

function cacheKey(attachment: ImageAttachment): string {
  return `${attachment.id ?? attachment.name}:${attachment.base64.length}`
}

function remember(key: string, value: AttachmentThumbnail | null): AttachmentThumbnail | null {
  if (cache.size >= THUMBNAIL_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
  return value
}

function thumbnailFor(attachment: ImageAttachment, encode: ThumbnailEncoder): AttachmentThumbnail | null {
  const key = cacheKey(attachment)
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Refresh recency: the Map keeps insertion order, so re-insert moves it last.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  try {
    return remember(key, encode(Buffer.from(attachment.base64, 'base64'), attachment.mimeType))
  } catch {
    return remember(key, null)
  }
}

/**
 * The attachment as a phone's transcript carries it: a thumbnail in place of
 * the bytes, flagged `preview` so the chip asks for the original when opened.
 * A PDF, or a picture the host cannot decode, travels with no bytes at all.
 */
export function previewAttachment(attachment: ImageAttachment, encode: ThumbnailEncoder = (defaultEncoder ??= nativeEncoder())): ImageAttachment {
  if (attachment.preview || !attachment.base64) return attachment
  const thumbnail = attachment.mimeType.startsWith('image/') ? thumbnailFor(attachment, encode) : null
  return thumbnail
    ? { ...attachment, base64: thumbnail.base64, mimeType: thumbnail.mimeType, preview: true }
    : { ...attachment, base64: '', preview: true }
}

/** `previewAttachment` over a message; the same object when there is nothing to shrink. */
export function withAttachmentPreviews(message: ChatMessage, encode?: ThumbnailEncoder): ChatMessage {
  if (!message.attachments?.some((attachment) => attachment.base64 && !attachment.preview)) return message
  return { ...message, attachments: message.attachments.map((attachment) => previewAttachment(attachment, encode)) }
}

/** The original attachment behind a thumbnail, from the message the host holds. */
export function findAttachment(message: Pick<ChatMessage, 'attachments'>, ref: { attachmentId?: string; name: string }): ImageAttachment | undefined {
  return message.attachments?.find((item) => (ref.attachmentId ? item.id === ref.attachmentId : item.name === ref.name))
}
