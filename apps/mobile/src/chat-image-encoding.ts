/**
 * What a picked picture must become before it is sent to the AI.
 *
 * The photo library hands back whatever the asset is — HEIC on every iPhone
 * since iOS 11, sometimes TIFF or AVIF — and neither the host's Read tool nor
 * the model API accept anything but JPEG, PNG, GIF and WebP. A 12 MP photo is
 * also several megabytes that the API downsizes past ~1568 px anyway, so the
 * phone re-encodes to a bounded edge before the bytes are encrypted, sent,
 * stored and replayed. Decisions live here as pure functions; the native
 * encode is done by `expo-image-manipulator` in `attachments.ts`.
 */

export type ChatImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** Longest edge a sent picture keeps; larger ones are scaled down to fit. */
export const MAX_CHAT_IMAGE_EDGE = 2048
export const CHAT_IMAGE_JPEG_QUALITY = 0.85

const MAGIC: ReadonlyArray<readonly [prefix: string, mime: ChatImageMime]> = [
  ['/9j/', 'image/jpeg'],
  ['iVBORw0KGgo', 'image/png'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
]

/**
 * The format the bytes actually are, from the first base64 characters — the
 * picker, the file name and the host can all disagree about a picture's type;
 * the bytes cannot. `null` for anything the AI cannot read (HEIC, TIFF, …).
 */
export function sniffChatImageMime(base64: string): ChatImageMime | null {
  const body = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64
  for (const [prefix, mime] of MAGIC) {
    if (body.startsWith(prefix)) return mime
  }
  return null
}

export type ChatImagePlan =
  /** Ship the file as it is; the AI reads it and it is already small enough. */
  | { kind: 'raw' }
  /** Decode and re-encode, scaled so the longest edge is `edge` (or untouched when null). */
  | { kind: 'encode'; format: 'jpeg' | 'png'; edge: number | null }

const RAW_OK: Record<string, ChatImageMime> = {
  'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  'image/png': 'image/png', png: 'image/png',
  'image/gif': 'image/gif', gif: 'image/gif',
  'image/webp': 'image/webp', webp: 'image/webp',
}

/**
 * Decide from what the picker reports (the bytes are checked afterwards with
 * `sniffChatImageMime`). A picture that already is a readable format and fits
 * the edge ships untouched — re-encoding a JPEG only loses quality. A GIF is
 * never re-encoded (that would drop its frames). A PNG that needs scaling stays
 * PNG so screenshots keep crisp text and transparency; everything else — HEIC,
 * TIFF, AVIF, oversized JPEG, unknown — becomes a JPEG.
 */
export function planChatImage(asset: { width: number; height: number; mimeType?: string | null; fileName?: string | null }): ChatImagePlan {
  const type = (asset.mimeType ?? '').toLowerCase()
  const ext = (asset.fileName ?? '').toLowerCase().split('.').pop() ?? ''
  const reported = RAW_OK[type] ?? RAW_OK[ext] ?? null
  if (reported === 'image/gif') return { kind: 'raw' }
  const longest = Math.max(asset.width, asset.height)
  const edge = longest > MAX_CHAT_IMAGE_EDGE ? MAX_CHAT_IMAGE_EDGE : null
  if (reported && !edge) return { kind: 'raw' }
  return { kind: 'encode', format: reported === 'image/png' ? 'png' : 'jpeg', edge }
}

/** The file name the AI sees, matching the bytes it will get. */
export function chatImageFileName(original: string | null | undefined, index: number, mime: ChatImageMime): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length)
  const base = (original ?? '').replace(/\.[^.]+$/, '') || `image-${index + 1}`
  return `${base}.${ext}`
}
