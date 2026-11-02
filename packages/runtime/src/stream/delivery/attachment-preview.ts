import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'

import { attachmentFragmentBytes, attachmentFragmentShell, MAX_FRAGMENT_BYTES } from '@superone/shared/transcript-window/fragment-message'

/** Longest side of the thumbnail a phone's transcript carries for a picture. */
export const ATTACHMENT_THUMBNAIL_MAX_SIDE = 256
export const THUMBNAIL_JPEG_QUALITY = 70
const THUMBNAIL_CACHE_LIMIT = 256

/**
 * Smaller copies tried when the first thumbnail would not fit in one transcript
 * fragment. The copy that fits is what travels. If none fit, the attachment
 * goes out with no bytes and its zone path still attached.
 */
const THUMBNAIL_LADDER: readonly ThumbnailLimits[] = [
  { maxSide: ATTACHMENT_THUMBNAIL_MAX_SIDE, quality: THUMBNAIL_JPEG_QUALITY },
  { maxSide: 160, quality: 55 },
  { maxSide: 96, quality: 40 },
]

/** A thumbnail as it replaces the attachment's bytes on the wire. */
export interface AttachmentThumbnail {
  base64: string
  mimeType: string
}

/** How large a thumbnail may be. Omitted means the ladder's first step. */
export interface ThumbnailLimits {
  maxSide: number
  quality: number
}

/** Produce the thumbnail for one picture, or `null` when the bytes cannot be decoded. */
export type ThumbnailEncoder = (bytes: Buffer, mimeType: string, limits?: ThumbnailLimits) => AttachmentThumbnail | null

/**
 * Thumbnails already cut, keyed by attachment identity and size. History is
 * re-sent on every open, page and reconnect; the picture never changes.
 */
const cache = new Map<string, AttachmentThumbnail | null>()

function cacheKey(attachment: ImageAttachment, limits: ThumbnailLimits): string {
  return `${attachment.id ?? attachment.name}:${attachment.base64.length}:${limits.maxSide}:${limits.quality}`
}

function remember(key: string, value: AttachmentThumbnail | null): AttachmentThumbnail | null {
  if (cache.size >= THUMBNAIL_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
  return value
}

function thumbnailFor(attachment: ImageAttachment, encode: ThumbnailEncoder, limits: ThumbnailLimits): AttachmentThumbnail | null {
  const key = cacheKey(attachment, limits)
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Refresh recency: the Map keeps insertion order, so re-insert moves it last.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  try {
    return remember(key, encode(Buffer.from(attachment.base64, 'base64'), attachment.mimeType, limits))
  } catch {
    return remember(key, null)
  }
}

/**
 * The attachment as a transcript window carries it: a thumbnail in place of
 * the bytes, flagged `preview` so opening it fetches the original. A picture
 * the host cannot decode, or whose thumbnail still will not fit in one
 * fragment, travels with no bytes. Its name and zone path stay on the shell,
 * so the desktop that staged the file can preview its local copy.
 */
export function previewAttachment(attachment: ImageAttachment, encode: ThumbnailEncoder): ImageAttachment {
  if (attachment.preview || !attachment.base64) return attachment
  if (!attachment.mimeType.startsWith('image/')) return { ...attachment, base64: '', preview: true }
  for (const limits of THUMBNAIL_LADDER) {
    const thumbnail = thumbnailFor(attachment, encode, limits)
    if (!thumbnail) break
    const next = { ...attachment, base64: thumbnail.base64, mimeType: thumbnail.mimeType, preview: true as const }
    if (attachmentFragmentBytes(next) <= MAX_FRAGMENT_BYTES) return next
  }
  return attachmentFragmentShell(attachment)
}

/** `previewAttachment` over a message; the same object when there is nothing to shrink. */
export function withAttachmentPreviews(message: ChatMessage, encode: ThumbnailEncoder): ChatMessage {
  if (!message.attachments?.some((attachment) => attachment.base64 && !attachment.preview)) return message
  return { ...message, attachments: message.attachments.map((attachment) => previewAttachment(attachment, encode)) }
}

/** The original attachment behind a thumbnail, from the message the host holds. */
export function findAttachment(message: Pick<ChatMessage, 'attachments'>, ref: { attachmentId?: string; name: string }): ImageAttachment | undefined {
  return message.attachments?.find((item) => (ref.attachmentId ? item.id === ref.attachmentId : item.name === ref.name))
}
