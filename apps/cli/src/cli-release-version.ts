/**
 * Resolve the SuperOne CLI release version for harness release coupling.
 *
 * Precedence:
 * 1. SUPERONE_CLI_VERSION env (tests / explicit override)
 * 2. Build-time inject via esbuild define `__SUPERONE_CLI_VERSION__`
 * 3. Adjacent dist MANIFEST.json (production tarball layout)
 * 4. Monorepo root package.json (dev / `tsx src/cli.ts`)
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

declare const __SUPERONE_CLI_VERSION__: string | undefined

export function resolveCliReleaseVersion(): string {
  const fromEnv = process.env.SUPERONE_CLI_VERSION?.trim()
  if (fromEnv) return fromEnv

  if (typeof __SUPERONE_CLI_VERSION__ === 'string' && __SUPERONE_CLI_VERSION__.trim()) {
    return __SUPERONE_CLI_VERSION__.trim()
  }

  const fromDist = readDistManifestVersion()
  if (fromDist) return fromDist

  const fromRepo = readMonorepoPackageVersion()
  if (fromRepo) return fromRepo

  throw new Error(
    'unable to determine CLI version for harness release coupling ' +
      '(set SUPERONE_CLI_VERSION or use a built dist with MANIFEST.json)',
  )
}

function readDistManifestVersion(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    // Dev: apps/cli/src → not a dist. Built: stageDir/lib/cli.mjs → ../MANIFEST.json
    const candidates = [
      join(here, '..', 'MANIFEST.json'),
      join(here, 'MANIFEST.json'),
      join(here, '..', '..', 'MANIFEST.json'),
    ]
    for (const p of candidates) {
      if (!existsSync(p)) continue
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { version?: unknown }
      if (typeof raw.version === 'string' && raw.version.trim()) return raw.version.trim()
    }
  } catch {
    return null
  }
  return null
}

function readMonorepoPackageVersion(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    // apps/cli/src → repo root package.json
    const rootPkg = join(here, '..', '..', '..', 'package.json')
    if (!existsSync(rootPkg)) return null
    const raw = JSON.parse(readFileSync(rootPkg, 'utf8')) as { name?: string; version?: string }
    if (typeof raw.version === 'string' && raw.version.trim()) return raw.version.trim()
  } catch {
    return null
  }
  return null
}
