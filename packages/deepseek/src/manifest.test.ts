/**
 * Every dsh package this workspace imports must be declared twice.
 *
 * A hoisted bun install puts transitive dependencies in the same flat
 * `node_modules`, so an undeclared import resolves fine in dev and in tests —
 * `@deepseek-ai/dsh-shell-env` did exactly that until it was caught by hand.
 * Two things break later instead of now:
 *
 * - `apps/desktop/electron.vite.config.ts` builds `mainExternal` from that
 *   app's own `dependencies`, so an undeclared package is not externalized and
 *   Rollup tries to bundle it into the main chunk.
 * - The package survives in the asar only for as long as something else keeps
 *   pulling it in.
 *
 * Both failures land after packaging, which is the worst place to find them.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(SRC, '..')
const DESKTOP_MANIFEST = join(PACKAGE_ROOT, '..', '..', 'apps', 'desktop', 'package.json')

/** `@scope/name` even when the import reaches a subpath. */
const DSH_IMPORT = /['"](@deepseek-ai\/[a-z0-9][a-z0-9-]*)(?:\/[^'"]*)?['"]/g

function dshImports(predicate: (file: string) => boolean): string[] {
  const found = new Set<string>()
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.ts') || !predicate(file)) continue
    const source = readFileSync(join(SRC, file), 'utf8')
    for (const [, name] of source.matchAll(DSH_IMPORT)) found.add(name)
  }
  return [...found].sort()
}

function declaredIn(manifestPath: string): Set<string> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
}

const isTest = (file: string) => file.endsWith('.test.ts')

describe('dsh dependency declarations', () => {
  it('declares every dsh package this workspace imports', () => {
    const declared = declaredIn(join(PACKAGE_ROOT, 'package.json'))
    const undeclared = dshImports(() => true).filter((name) => !declared.has(name))

    expect(undeclared).toEqual([])
  })

  // Runtime imports have to reach the packaged app; test-only ones do not.
  it('declares every runtime dsh package in the desktop app that ships it', () => {
    const declared = declaredIn(DESKTOP_MANIFEST)
    const undeclared = dshImports((file) => !isTest(file)).filter((name) => !declared.has(name))

    expect(undeclared).toEqual([])
  })

  // A version drift between the two manifests means dev and packaged builds can
  // resolve different code for the same import.
  it('pins the same version in both manifests', () => {
    const here = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).dependencies
    const desktop = JSON.parse(readFileSync(DESKTOP_MANIFEST, 'utf8')).dependencies
    const drifted = Object.keys(here as Record<string, string>)
      .filter((name) => name.startsWith('@deepseek-ai/'))
      .filter((name) => desktop[name] !== undefined && desktop[name] !== here[name])
      .map((name) => `${name}: ${here[name]} vs ${desktop[name]}`)

    expect(drifted).toEqual([])
  })
})
