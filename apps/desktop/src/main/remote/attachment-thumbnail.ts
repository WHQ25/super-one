import { createRequire } from 'module'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import {
  ATTACHMENT_THUMBNAIL_MAX_SIDE,
  THUMBNAIL_JPEG_QUALITY,
  findAttachment,
  previewAttachment as previewWith,
  withAttachmentPreviews as previewsWith,
  type ThumbnailEncoder,
} from '@superone/runtime/stream/delivery/attachment-preview'

export {
  ATTACHMENT_THUMBNAIL_MAX_SIDE,
  THUMBNAIL_JPEG_QUALITY,
  findAttachment,
  type AttachmentThumbnail,
  type ThumbnailEncoder,
} from '@superone/runtime/stream/delivery/attachment-preview'

const requireElectron = createRequire(import.meta.url)

interface ThumbnailNativeImage {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: (opts: { width: number; height: number; quality?: string }) => ThumbnailNativeImage
  toJPEG: (quality: number) => Buffer
}

/**
 * Electron's own decoder: PNG and JPEG only, which is what the phone sends
 * and what desktop pastes. A GIF or WebP comes back `null` and travels as an
 * icon chip until opened.
 */
function nativeEncoder(): ThumbnailEncoder {
  // Lazy so unit tests can run the projection without loading Electron.
  const { nativeImage } = requireElectron('electron') as typeof import('electron')
  return (bytes, _mime, limits) => {
    const image = nativeImage.createFromBuffer(bytes) as unknown as ThumbnailNativeImage
    if (image.isEmpty()) return null
    const maxSide = limits?.maxSide ?? ATTACHMENT_THUMBNAIL_MAX_SIDE
    const { width, height } = image.getSize()
    const scale = Math.min(1, maxSide / Math.max(width, height, 1))
    const small = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
      : image
    return { base64: small.toJPEG(limits?.quality ?? THUMBNAIL_JPEG_QUALITY).toString('base64'), mimeType: 'image/jpeg' }
  }
}

let defaultEncoder: ThumbnailEncoder | null = null

function encoder(encode?: ThumbnailEncoder): ThumbnailEncoder {
  return encode ?? (defaultEncoder ??= nativeEncoder())
}

export function previewAttachment(attachment: ImageAttachment, encode?: ThumbnailEncoder): ImageAttachment {
  return previewWith(attachment, encoder(encode))
}

export function withAttachmentPreviews(message: ChatMessage, encode?: ThumbnailEncoder): ChatMessage {
  return previewsWith(message, encoder(encode))
}
