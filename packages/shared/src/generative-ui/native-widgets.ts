/**
 * Native widget templates — `widget_show({ template: '@native/…' })`.
 *
 * A normal widget ships its own HTML into an iframe. A native template instead asks the host to
 * render one of SuperOne's own surfaces, so agent-authored code can produce a result that looks and
 * behaves exactly like a built-in one (drag to Finder, viewer, download) rather than a lookalike
 * rebuilt inside the frame.
 *
 * The payload deliberately carries **already-built render items**: the host prepared them (bytes
 * written to disk, previews attached) before the result was returned, so the renderer only has to
 * hand them to the gallery it already mounts at the end of every turn.
 *
 * `parseNativeWidgetResult` is the **single** predicate behind both halves of the hide contract —
 * the tool row is hidden and the gallery collects the items from the same call, so the two can
 * never drift into either a double render or a blank turn.
 */
import type { ImageGenerationItem, VideoGenerationItem } from '../agent-types'

export const NATIVE_TEMPLATE_PREFIX = '@native/'

export const NATIVE_WIDGET_TYPES = ['image-gallery', 'video-gallery', 'files-previewer'] as const
export type NativeWidgetType = (typeof NATIVE_WIDGET_TYPES)[number]

/**
 * How one `@native/files-previewer` entry renders. The name-derived kinds mirror
 * `FilePreviewKind`; the last two are host verdicts the renderer cannot reach on
 * its own — a NUL in the first bytes, a file past the read cap, a path outside
 * every root the media server serves, or nothing at the path at all.
 */
export type PreviewerFileKind =
  | 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'notebook' | 'text'
  | 'unpreviewable'
  | 'missing'

export type PreviewerUnpreviewableReason = 'binary' | 'too_large' | 'outside_readable_roots'

export interface PreviewerFile {
  /** As the agent wrote it — what the header shows. */
  path: string
  /** Host-resolved; what every read and open uses. */
  absolutePath: string
  name: string
  kind: PreviewerFileKind
  /** Bytes; absent when missing. */
  size?: number
  /** Present only when `kind` is `unpreviewable`. */
  reason?: PreviewerUnpreviewableReason
  note?: string
}

/** Host-enforced input limits; the result must survive every harness's tool-result cap. */
export const FILES_PREVIEWER_MAX_FILES = 50
export const FILES_PREVIEWER_MAX_NOTE_CHARS = 500

export interface NativeWidgetPayload {
  kind: 'native'
  nativeType: NativeWidgetType
  title: string
  /** Present for `image-gallery`. */
  images?: ImageGenerationItem[]
  /** Present for `video-gallery`. */
  videos?: VideoGenerationItem[]
  /** Present for `files-previewer`: the root every `absolutePath` was resolved against. */
  root?: string
  /** Present for `files-previewer`. */
  files?: PreviewerFile[]
}

/**
 * Saved template ids are validated against `/^[a-z0-9][a-z0-9_-]*$/`, so the `@native/` namespace
 * is unreachable by a user template and needs no collision handling.
 */
export function isNativeTemplateId(template: string): boolean {
  return template.startsWith(NATIVE_TEMPLATE_PREFIX)
}

export function nativeTypeFromTemplateId(template: string): NativeWidgetType | null {
  if (!isNativeTemplateId(template)) return null
  const suffix = template.slice(NATIVE_TEMPLATE_PREFIX.length)
  return (NATIVE_WIDGET_TYPES as readonly string[]).includes(suffix) ? suffix as NativeWidgetType : null
}

function renderableItems<T extends { savedPath?: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is T => {
    if (!item || typeof item !== 'object') return false
    const path = (item as { savedPath?: unknown }).savedPath
    return typeof path === 'string' && path.trim().length > 0
  })
}

/**
 * Parse a `widget_show` result into a native payload, or null when the row should render normally.
 *
 * Total by construction: malformed JSON, a code widget, an unknown `nativeType` (a payload from a
 * newer build), and an empty item list all fall back to null — the caller then keeps the tool row,
 * which is the only outcome that cannot lose output.
 */
export function parseNativeWidgetResult(resultText: string | undefined): NativeWidgetPayload | null {
  if (!resultText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(resultText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>
  if (record.kind !== 'native') return null
  const nativeType = typeof record.nativeType === 'string' ? nativeTypeFromTemplateId(NATIVE_TEMPLATE_PREFIX + record.nativeType) : null
  if (!nativeType) return null

  const title = typeof record.title === 'string' ? record.title : ''

  if (nativeType === 'image-gallery') {
    const images = renderableItems<ImageGenerationItem>(record.images)
    return images.length > 0 ? { kind: 'native', nativeType, title, images } : null
  }
  if (nativeType === 'files-previewer') {
    // The previewer renders in place; it must never carry gallery items or the
    // turn-end collectors would show it twice.
    if (record.images !== undefined || record.videos !== undefined) return null
    const files = previewerFiles(record.files)
    const root = typeof record.root === 'string' ? record.root : ''
    return files.length > 0 && root ? { kind: 'native', nativeType, title, root, files } : null
  }
  const videos = renderableItems<VideoGenerationItem>(record.videos)
  return videos.length > 0 ? { kind: 'native', nativeType, title, videos } : null
}

const PREVIEWER_KINDS: ReadonlySet<string> = new Set([
  'image', 'pdf', 'video', 'audio', 'markdown', 'notebook', 'text', 'unpreviewable', 'missing',
])

function previewerFiles(value: unknown): PreviewerFile[] {
  if (!Array.isArray(value)) return []
  const files: PreviewerFile[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.path !== 'string' || typeof r.absolutePath !== 'string' || typeof r.name !== 'string') continue
    if (typeof r.kind !== 'string' || !PREVIEWER_KINDS.has(r.kind)) continue
    files.push({
      path: r.path,
      absolutePath: r.absolutePath,
      name: r.name,
      kind: r.kind as PreviewerFileKind,
      ...(typeof r.size === 'number' && Number.isFinite(r.size) ? { size: r.size } : {}),
      ...(typeof r.reason === 'string' ? { reason: r.reason as PreviewerUnpreviewableReason } : {}),
      ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
    })
  }
  return files
}
