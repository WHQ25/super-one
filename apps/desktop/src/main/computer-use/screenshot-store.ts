import { join } from 'path'
import { tmpdir } from 'os'
import {
  AGENT_SCREENSHOT_MAX_BYTES,
  needsAgentScreenshotOptimize,
  persistBase64Screenshot,
  writeOptimizedAgentScreenshot,
  type PersistedScreenshotArtifact,
  type ScreenshotArtifactDeps,
} from '../agent/screenshot-artifact'

/**
 * Fixed directory for Computer Use captures (observe / zoom).
 * Optimization is shared with browser screenshots via agent/screenshot-artifact.
 */
export const COMPUTER_USE_SCREENSHOT_DIR = join(tmpdir(), 'super-one-computer-use-screenshots')

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
