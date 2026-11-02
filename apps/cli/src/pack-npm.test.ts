import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPublishPackageJson, packNpm, PUBLIC_CLI_PACKAGE } from '../scripts/pack-npm'

const HERE = dirname(fileURLToPath(import.meta.url))

function npmPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null
  }
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]!
  if (isBuiltin(name) || isBuiltin(`node:${name}`)) return null
  return name
}

/** Package names the bundled CLI still `require()`s that npm will not install. */
function undeclaredRuntimeRequires(
  bundle: string,
  pkg: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> },
): string[] {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])
  const undeclared = new Set<string>()
  // Banner `require` is renamed to require2/require3 when the source also
  // binds `require`. Quoted `require("…")` inside Ajv codegen strings is data.
  const call = /(?<!['"`])\brequire\d*\(\s*(["'])([^"']+)\1\s*\)/g
  for (const match of bundle.matchAll(call)) {
    const name = npmPackageName(match[2]!)
    if (name && !declared.has(name)) undeclared.add(name)
  }
  return [...undeclared].sort()
}

describe('pack-npm', () => {
  it('flags a leftover require of a package npm will not install', () => {
    const bundle = [
      'var jpeg = require2("jpeg-js");',
      'const sqlite = require("better-sqlite3");',
      'const fs = require("fs");',
      'uri.code = \'require("ajv/dist/runtime/uri").default\';',
      '(0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`',
    ].join('\n')
    expect(
      undeclaredRuntimeRequires(bundle, { dependencies: { 'better-sqlite3': '^13.0.1' } }),
    ).toEqual(['jpeg-js'])
  })

  it('declares the dependency node floor on the publish manifest', () => {
    const pkg = buildPublishPackageJson('0.0.0-test') as {
      engines: { node: string }
    }
    expect(pkg.engines.node).toBe('>=22.13.0')
    const workspaceCli = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
      engines: { node: string }
    }
    const cursor = JSON.parse(
      readFileSync(join(HERE, '..', '..', '..', 'packages', 'cursor', 'package.json'), 'utf8'),
    ) as { engines: { node: string } }
    expect(workspaceCli.engines.node).toBe('>=22.13.0')
    expect(cursor.engines.node).toBe('>=22.13.0')
  })

  it.each(['0.0.0-test', '0.0.0-alpha.1'])('builds an isolated publishable CLI for %s', async (version) => {
    const outDir = join(HERE, '..', 'dist', 'npm-test-out')
    rmSync(outDir, { recursive: true, force: true })

    const result = await packNpm({ version, outDir })
    expect(result.packageName).toBe(PUBLIC_CLI_PACKAGE)
    expect(result.version).toBe(version)

    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8')) as {
      name: string
      version: string
      engines: { node: string }
      dependencies: Record<string, string>
      optionalDependencies: Record<string, string>
      bin: Record<string, string>
    }
    expect(pkg.name).toBe('@super-one/cli')
    expect(pkg.version).toBe(version)
    expect(pkg.engines.node).toBe('>=22.13.0')
    expect(pkg.bin.superone).toMatch(/bin\/superone\.mjs$/)
    expect(pkg.dependencies['better-sqlite3']).toBeTruthy()
    expect(pkg.dependencies['node-pty']).toBeTruthy()
    expect(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).toBeTruthy()
    expect(pkg.dependencies['@cursor/sdk']).toBeTruthy()
    // No monorepo workspace protocol in the publish manifest.
    for (const v of Object.values(pkg.dependencies)) {
      expect(v).not.toMatch(/^workspace:/)
    }
    expect(Object.keys(pkg.optionalDependencies).some((k) => k.includes('claude-agent-sdk-'))).toBe(
      true,
    )
    expect(Object.keys(pkg.optionalDependencies).some((k) => k.startsWith('@cursor/sdk-'))).toBe(
      true,
    )

    expect(existsSync(join(outDir, 'lib', 'cli.mjs'))).toBe(true)
    expect(existsSync(join(outDir, 'bin', 'superone.mjs'))).toBe(true)
    expect(existsSync(join(outDir, 'MANIFEST.json'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(outDir, 'MANIFEST.json'), 'utf8')) as {
      minNode: string
    }
    expect(manifest.minNode).toBe('22.13.0')

    const bundle = readFileSync(join(outDir, 'lib', 'cli.mjs'), 'utf8')
    const channel = version.includes('-alpha') ? 'alpha' : 'stable'
    expect(bundle.indexOf(`process.env.SUPERONE_VARIANT = "${channel}";`)).toBeLessThan(bundle.indexOf('var DEFAULT_NODE_HOME'))
    expect(bundle).toContain(`process.env.SUPERONE_VARIANT = "${channel}";`)
    // Bundled CLI should not leave monorepo package names as bare imports.
    expect(bundle.includes('from "@superone/runtime"')).toBe(false)
    expect(bundle.includes('from "@superone/shared"')).toBe(false)
    expect(undeclaredRuntimeRequires(bundle, pkg)).toEqual([])
    // Cursor SDK must stay external (native/platform package, not rebundled).
    // It is loaded on first use, so the bundle references it by dynamic import.
    expect(bundle).toMatch(/(?:from |import\()["']@cursor\/sdk["']/)
    // Version inject for harness release coupling.
    expect(bundle.includes(version)).toBe(true)

    rmSync(outDir, { recursive: true, force: true })
  }, 60_000)
})
