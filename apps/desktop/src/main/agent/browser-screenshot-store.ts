import { join } from 'path'
import { tmpdir } from 'os'
import {
  persistBase64Screenshot,
  type PersistedScreenshotArtifact,
  type ScreenshotArtifactDeps,
} from './screenshot-artifact'

export const BROWSER_SCREENSHOT_DIR = join(tmpdir(), 'super-one-browser-screenshots')

/**
 * Persist a browser screenshot's base64 image to a temp file and return the
 * absolute path. Oversized files are JPEG-re-encoded (same pixels) for agent Read —
 * shared with Computer Use via screenshot-artifact.
 *
 * Returns null if the write fails. Callers that only need the path can ignore
 * the rich result via {@link persistScreenshot}.
 */
export function persistScreenshotArtifact(
  base64: string,
  mimeType: string,
  declared?: { width?: number; height?: number },
  deps?: ScreenshotArtifactDeps,
): PersistedScreenshotArtifact | null {
  return persistBase64Screenshot(BROWSER_SCREENSHOT_DIR, base64, mimeType, declared, deps)
}

/**
 * Persist a browser screenshot and return the path (or null).
 * API kept stable for browser_mcp_tools.
 */
export function persistScreenshot(base64: string, mimeType: string): string | null {
  return persistScreenshotArtifact(base64, mimeType)?.path ?? null
}
