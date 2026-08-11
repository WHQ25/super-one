/**
 * Desktop harness install root.
 *
 * Production (and any non-dev host): the **shared** SuperOne harness root
 * `~/.superone/harness` — same path the CLI uses (`@superone/runtime`
 * `resolveHarnessHomeRoot`). Desktop and remote-node installs share binaries.
 *
 * Dev (`is.dev`): `<userData>/harness` → `apps/desktop/.dev-data/harness` so
 * local enable/download testing does not clobber the real user install.
 * Override either mode with `SUPERONE_HARNESS_HOME`.
 */

import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  resolveHarnessHomeRoot as resolveSharedHarnessHomeRoot,
} from '@superone/runtime/harness'

function userHome(): string {
  try {
    return app.getPath('home')
  } catch {
    return homedir()
  }
}

function devHarnessRoot(): string | null {
  if (!is.dev) return null
  try {
    return join(app.getPath('userData'), 'harness')
  } catch {
    return null
  }
}

export function resolveHarnessHomeRoot(): string {
  // Explicit env wins in every mode (labs / CI).
  const fromEnv = process.env.SUPERONE_HARNESS_HOME?.trim()
  if (fromEnv) return fromEnv

  const dev = devHarnessRoot()
  if (dev) return dev

  return resolveSharedHarnessHomeRoot({ userHome: userHome(), ignoreEnv: true })
}
