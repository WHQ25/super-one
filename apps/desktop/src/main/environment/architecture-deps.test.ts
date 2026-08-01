import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Architecture guard: packages that will host node-runtime / apps/cli must
 * never import Electron. Phase 0 installs the guard before those packages are
 * fully populated so later vertical slices cannot accidentally pull Electron.
 */

// apps/desktop/src/main/environment → repo root (5 levels up)
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

const GUARDED_PACKAGE_ROOTS = [
  join(REPO_ROOT, 'packages/node-runtime'),
  join(REPO_ROOT, 'apps/cli'),
  join(REPO_ROOT, 'packages/shared/src/environment'),
] as const

// Phase 5: platform-neutral client cores live under packages/shared/src/environment
// and must remain Electron-free for mobile adapters.

const ELECTRON_IMPORT_RE =
  /(?:from\s+['"]electron(?:\/[^'"]*)?['"]|require\s*\(\s*['"]electron(?:\/[^'"]*)?['"]\s*\)|import\s*\(\s*['"]electron(?:\/[^'"]*)?['"]\s*\))/

const SOURCE_EXT_RE = /\.(ts|tsx|js|mjs|cjs)$/

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkSourceFiles(full, out)
    } else if (SOURCE_EXT_RE.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

function findElectronImports(root: string): string[] {
  const hits: string[] = []
  for (const file of walkSourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    if (ELECTRON_IMPORT_RE.test(text)) {
      hits.push(relative(REPO_ROOT, file))
    }
  }
  return hits
}

describe('architecture dependency guards', () => {
  it('forbids Electron imports in shared environment contracts', () => {
    const hits = findElectronImports(join(REPO_ROOT, 'packages/shared/src/environment'))
    expect(hits).toEqual([])
  })

  it('forbids Electron imports in node-runtime and apps/cli when present', () => {
    for (const root of GUARDED_PACKAGE_ROOTS) {
      if (!existsSync(root)) continue
      const hits = findElectronImports(root)
      expect(hits, `Electron imports under ${relative(REPO_ROOT, root)}`).toEqual([])
    }
  })

  it('requires apps/cli to exist for Phase 1+', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/cli/package.json'))).toBe(true)
  })

  it('documents the packages that must stay Electron-free', () => {
    expect(GUARDED_PACKAGE_ROOTS.map((p) => relative(REPO_ROOT, p))).toEqual([
      'packages/node-runtime',
      'apps/cli',
      'packages/shared/src/environment',
    ])
  })
})

