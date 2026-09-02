/**
 * Desktop harness install root.
 *
 * Production: `~/.superone/<variant harnessDirName>`. The store is NOT shared
 * between the side-by-side variants: `pruneVersions` keeps only the newest few
 * versions and deletes the rest, so a shared root lets one variant delete the
 * harness binary the other is executing. Stable keeps the historical
 * `~/.superone/harness`, which is also what the CLI resolves to.
 *
 * Dev (`is.dev`): `<userData>/harness` → `apps/desktop/.dev-data/harness` so
 * local enable/download testing does not clobber the real user install.
 * Override either mode with `SUPERONE_HARNESS_HOME`.
 */

import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SUPERONE_DIRNAME } from '@superone/runtime/harness'
import { variant } from '../variant'

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

  return join(userHome(), SUPERONE_DIRNAME, variant().harnessDirName)
}
