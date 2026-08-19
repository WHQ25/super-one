/**
 * Test support: where the shipped agent presets live in the repository.
 *
 * Since the model-facing tool rows moved to the preset plane, a runtime booted
 * without a roster reaches the model with **no dsh tools at all**. That is not
 * a shape SuperOne ships — the desktop app always points the roster at the
 * copies it packages through `extraResources` — so a test that exercises tools,
 * sandboxing, delegation, or compaction has to compose the same way production
 * does.
 */

import { fileURLToPath } from 'node:url'

/** The vendored `system`-trust preset root, resolved from this package's source. */
export const SHIPPED_PRESET_ROOT = fileURLToPath(
  new URL('../../../apps/desktop/resources/agent-presets/', import.meta.url),
)

/** Roster options every runtime under test composes with. */
export const TEST_PRESET_OPTIONS = {
  presetRoots: [SHIPPED_PRESET_ROOT],
} as const
