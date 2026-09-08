import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRealPath } from './path-security'

/** Exact completed download paths; never grant their containing directory. */
export class MediaFileGrants {
  private paths: Set<string>

  constructor(private readonly manifest: string) {
    try {
      const saved: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      this.paths = new Set(Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : [])
    } catch {
      this.paths = new Set()
    }
  }

  add(path: string): void {
    const real = resolveRealPath(path)
    if (this.paths.has(real)) return
    const next = new Set(this.paths).add(real)
    const temp = `${this.manifest}.tmp`
    writeFileSync(temp, JSON.stringify([...next]), { mode: 0o600 })
    renameSync(temp, this.manifest)
    this.paths = next
  }

  has(path: string): boolean {
    // Stored paths are already canonical. Do not re-resolve grants: replacing
    // a granted file with a symlink must not grant the symlink's new target.
    return this.paths.has(resolveRealPath(path))
  }
}

let cached: { root: string; grants: MediaFileGrants } | undefined
export function mediaFileGrants(): MediaFileGrants {
  const root = app.getPath('userData')
  if (cached?.root !== root) {
    mkdirSync(root, { recursive: true })
    cached = { root, grants: new MediaFileGrants(join(root, 'media-file-grants.json')) }
  }
  return cached.grants
}
