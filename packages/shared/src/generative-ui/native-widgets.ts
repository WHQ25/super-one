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

export const NATIVE_WIDGET_TYPES = ['image-gallery', 'video-gallery'] as const
export type NativeWidgetType = (typeof NATIVE_WIDGET_TYPES)[number]

export interface NativeWidgetPayload {
  kind: 'native'
  nativeType: NativeWidgetType
  title: string
  /** Present for `image-gallery`. */
  images?: ImageGenerationItem[]
  /** Present for `video-gallery`. */
  videos?: VideoGenerationItem[]
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
  const videos = renderableItems<VideoGenerationItem>(record.videos)
  return videos.length > 0 ? { kind: 'native', nativeType, title, videos } : null
}
