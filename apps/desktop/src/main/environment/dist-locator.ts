import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locate the `superone` distribution tarball this desktop can install remotely.
 *
 * Packaged builds ship the artifacts under `resources/superone-dist/`; in
 * development they come from `apps/cli/dist/` after `bun run build:cli:dist`.
 */

const TARBALL_RE = /^superone-(.+)-([a-z0-9]+-[a-z0-9]+)\.tar\.gz$/

export interface DistArtifact {
  path: string
  version: string
  target: string
}

export function distSearchDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    dirs.push(join(process.resourcesPath, 'superone-dist'))
  } else {
    // apps/desktop/out/main → repo root
    dirs.push(join(app.getAppPath(), '../../apps/cli/dist'))
    dirs.push(join(app.getAppPath(), '../cli/dist'))
  }
  return dirs
}

/** Newest artifact for a target, or null when none is bundled. */
export function findDistArtifact(target: string, dirs = distSearchDirs()): DistArtifact | null {
  const found: DistArtifact[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const match = TARBALL_RE.exec(name)
      if (!match || match[2] !== target) continue
      found.push({ path: join(dir, name), version: match[1]!, target })
    }
  }
  if (found.length === 0) return null
  // Lexicographic on version is enough to break ties between builds of one target.
  found.sort((a, b) => b.version.localeCompare(a.version))
  return found[0]!
}

/** User-facing hint when no artifact is available for a probed host. */
export function missingArtifactMessage(target: string): string {
  return (
    `No superone distribution bundled for ${target}. ` +
    `Build one with: bun run --filter @superone/cli build:dist --target ${target}`
  )
}
