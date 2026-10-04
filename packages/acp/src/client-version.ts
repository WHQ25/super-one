import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let cached: string | null = null

/**
 * SuperOne product version for the node ACP client.
 * Workspace packages are `0.0.0`; walk up to the `super-one` package.
 */
export function resolveNodeAcpClientVersion(): string {
  if (cached) return cached
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === 'super-one' && pkg.version && pkg.version !== '0.0.0') {
          cached = pkg.version
          return cached
        }
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  cached = '0.0.0'
  return cached
}
