import {
  parseNativeWidgetResult,
  type NativeWidgetPayload,
} from '@superone/shared/generative-ui/native-widgets'

export function parsePortableNativeWidgetResult(result: string | undefined): NativeWidgetPayload | null {
  const direct = parseNativeWidgetResult(result)
  if (direct || !result) return direct
  try {
    const nested = JSON.parse(result) as unknown
    return typeof nested === 'string' ? parseNativeWidgetResult(nested) : null
  } catch {
    return null
  }
}

/** The two turn-end gallery types; anything else renders in place or not at all. */
export function isGalleryPayload(payload: NativeWidgetPayload): boolean {
  return payload.nativeType === 'image-gallery' || payload.nativeType === 'video-gallery'
}

export function portableFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
