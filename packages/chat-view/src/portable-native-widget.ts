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

export function portableFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
