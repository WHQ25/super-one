import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../..')
const desktopManifestPath = join(repoRoot, 'apps/desktop/package.json')
const deepseekManifestPath = join(repoRoot, 'packages/deepseek/package.json')

function readManifest(filePath: string): PackageManifest {
  return JSON.parse(readFileSync(filePath, 'utf8')) as PackageManifest
}

function getDeepseekDeps(manifest: PackageManifest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(manifest.dependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/'))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function resolvePackageManifest(pkgName: string, requireFromDesktop: NodeRequire): PackageManifest {
  try {
    return readManifest(requireFromDesktop.resolve(`${pkgName}/package.json`))
  } catch {
    const hoistedPath = join(repoRoot, 'node_modules', pkgName, 'package.json')
    if (existsSync(hoistedPath)) {
      return readManifest(hoistedPath)
    }
    throw new Error(`Cannot resolve ${pkgName}/package.json`)
  }
}

describe('DeepSeek peer dependencies', () => {
  it('keeps @deepseek-ai/* dependencies aligned between desktop and deepseek manifests', () => {
    const desktopDeps = getDeepseekDeps(readManifest(desktopManifestPath))
    const deepseekDeps = getDeepseekDeps(readManifest(deepseekManifestPath))

    expect(desktopDeps).toEqual(deepseekDeps)
  })

  it('declares every required peerDependency of @deepseek-ai/* packages in desktop dependencies', () => {
    const desktopDeps = readManifest(desktopManifestPath).dependencies ?? {}
    const requireFromDesktop = createRequire(desktopManifestPath)
    const missing: string[] = []

    for (const dep of Object.keys(desktopDeps)) {
      if (!dep.startsWith('@deepseek-ai/')) continue
      const pkg = resolvePackageManifest(dep, requireFromDesktop)
      const peers = pkg.peerDependencies ?? {}
      const meta = pkg.peerDependenciesMeta ?? {}
      for (const peer of Object.keys(peers)) {
        if (!meta[peer]?.optional && !(peer in desktopDeps)) {
          missing.push(`${dep} -> ${peer}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
