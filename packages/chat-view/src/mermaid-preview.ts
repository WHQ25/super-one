import { requestNative } from './bridge'

/** Upper bound so a runaway render cannot flood the native bridge. */
const MAX_SVG_CHARS = 2_000_000

/**
 * Mermaid output the host can put on its own fullscreen viewer. It has to be
 * an SVG the renderer already painted — not a file path, and not markup that
 * would run a script once the native page loads it.
 */
export function isPreviewableMermaid(svg: unknown): svg is string {
  if (typeof svg !== 'string') return false
  if (svg.length < 11 || svg.length > MAX_SVG_CHARS) return false
  if (!/<svg[\s>]/i.test(svg)) return false
  if (/<script[\s>]/i.test(svg)) return false
  return true
}

/**
 * Open a mermaid diagram on the host's fullscreen viewer, off the transcript
 * document. Pinch-zoom then belongs to that page; dismissing it cannot leave
 * the chat WebView scaled, which is what an in-document overlay did.
 */
export function previewMermaid(svg: string): void {
  requestNative('previewMermaid', { svg })
}

/** True when the chat document is hosted by the phone's native shell. */
export function hasNativeHost(): boolean {
  return Boolean((globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView)
}
