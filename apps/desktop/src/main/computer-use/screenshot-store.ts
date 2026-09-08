import {
  AGENT_SCREENSHOT_MAX_BYTES,
  needsAgentScreenshotOptimize,
  persistBase64Screenshot,
  writeOptimizedAgentScreenshot,
  type PersistedScreenshotArtifact,
  type ScreenshotArtifactDeps,
} from '../agent/screenshot-artifact'

import { COMPUTER_USE_SCREENSHOT_DIR } from '../media-output-paths'

/** Fixed directory shared with the chat media readers. */
export { COMPUTER_USE_SCREENSHOT_DIR } from '../media-output-paths'

/** @deprecated Use AGENT_SCREENSHOT_MAX_BYTES — kept for existing imports/tests. */
export const CU_AGENT_MAX_BYTES = AGENT_SCREENSHOT_MAX_BYTES
/** Documentation / capture budget; agent path does not resize. */
export const CU_AGENT_MAX_SIDE = 1440

export type PersistedComputerUseScreenshot = PersistedScreenshotArtifact
export type ScreenshotStoreDeps = ScreenshotArtifactDeps

export const needsComputerUseOptimize = needsAgentScreenshotOptimize
export const writeOptimizedAgentImage = writeOptimizedAgentScreenshot

/**
 * Persist a Computer Use capture, then JPEG-optimize when oversized.
 */
export function persistComputerUseScreenshot(
  base64: string,
  mimeType: string = 'image/png',
  declared?: { width?: number; height?: number },
  options: { dir?: string; deps?: ScreenshotArtifactDeps } = {},
): PersistedComputerUseScreenshot | null {
  return persistBase64Screenshot(
    options.dir ?? COMPUTER_USE_SCREENSHOT_DIR,
    base64,
    mimeType,
    declared,
    options.deps,
  )
}
