/**
 * Harness sandbox gating lives in `@superone/shared` so Remote Control (mobile)
 * shows the same chip vocabulary the desktop status bar does. This module stays
 * as the renderer's import path.
 */
export {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
  harnessSandboxSupportLevel,
  harnessSupportsSandbox,
  sandboxModeFromInfo,
} from '@superone/shared/harness/harness-sandbox'
