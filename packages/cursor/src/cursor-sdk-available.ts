/**
 * Node-only probe for whether `@cursor/sdk` is resolvable in this install.
 * Keep out of `cursor-config.ts` so the renderer can import config helpers safely.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Whether `@cursor/sdk` can be resolved
 * (optional platform packages may still be missing at runtime).
 */
export function isCursorSdkAvailable(): boolean {
  try {
    require.resolve('@cursor/sdk')
    return true
  } catch {
    return false
  }
}
