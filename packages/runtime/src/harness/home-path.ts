/**
 * Canonical harness filesystem root — shared by CLI node and desktop.
 *
 * Production default: `$HOME/.superone/harness`
 *
 * Layout under the root (see `managed-layout.ts` / `managed-release.ts`):
 * ```
 * ~/.superone/harness/
 *   claude|codex/versions/<runtimeVersion>/
 *   claude|codex/current
 *   releases/<cliVersion>/harnesses/<id>/…   # offline artifacts
 *   .download/                               # resumable partial cache
 *   release-manifest.json                    # optional offline pins
 * ```
 *
 * Override (tests / labs): `SUPERONE_HARNESS_HOME`.
 * Node state (sqlite, pairing) stays at `~/.superone/node` — only runtime
 * binaries share this harness root.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Relative segment under `~/.superone/`. */
export const HARNESS_HOME_DIRNAME = 'harness'

/** SuperOne product data dir under the user home. */
export const SUPERONE_DIRNAME = '.superone'

/**
 * Default absolute harness root: `~/.superone/harness`.
 * Does not read env — use `resolveHarnessHomeRoot` for overrides.
 */
export function defaultHarnessHomeRoot(userHome: string = homedir()): string {
  return join(userHome, SUPERONE_DIRNAME, HARNESS_HOME_DIRNAME)
}

export interface ResolveHarnessHomeRootOptions {
  /** Explicit absolute path (wins over env). */
  override?: string | null
  /** User home for the default path. */
  userHome?: string
  /**
   * When true, ignore `SUPERONE_HARNESS_HOME` (hosts that apply their own
   * isolation, e.g. desktop `is.dev` → `.dev-data/harness`).
   */
  ignoreEnv?: boolean
}

/**
 * Resolve the harness install root used by every host.
 *
 * Order: `override` → `SUPERONE_HARNESS_HOME` → `~/.superone/harness`.
 */
export function resolveHarnessHomeRoot(opts: ResolveHarnessHomeRootOptions = {}): string {
  const explicit = opts.override?.trim()
  if (explicit) return explicit

  if (!opts.ignoreEnv) {
    const fromEnv = process.env.SUPERONE_HARNESS_HOME?.trim()
    if (fromEnv) return fromEnv
  }

  return defaultHarnessHomeRoot(opts.userHome)
}
