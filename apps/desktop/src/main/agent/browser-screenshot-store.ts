import {
  persistBase64Screenshot,
  type PersistedScreenshotArtifact,
  type ScreenshotArtifactDeps,
} from './screenshot-artifact'

/**
 * Persist a browser screenshot's base64 image into the session's sync zone and
 * return the absolute path. Oversized files are JPEG-re-encoded (same pixels)
 * for agent Read — shared with Computer Use via screenshot-artifact.
 *
 * Returns null if the write fails. Callers that only need the path can ignore
 * the rich result via {@link persistScreenshot}.
 */
export function persistScreenshotArtifact(
  sessionId: string | null | undefined,
  base64: string,
  mimeType: string,
  declared?: { width?: number; height?: number },
  deps?: ScreenshotArtifactDeps,
): PersistedScreenshotArtifact | null {
  return persistBase64Screenshot({ sessionId, producer: 'browser' }, base64, mimeType, declared, deps)
}

/**
 * Persist a browser screenshot and return the path (or null).
 * API kept stable for browser_mcp_tools.
 */
export function persistScreenshot(sessionId: string | null | undefined, base64: string, mimeType: string): string | null {
  return persistScreenshotArtifact(sessionId, base64, mimeType)?.path ?? null
}
