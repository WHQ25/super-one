import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packNpm, PUBLIC_CLI_PACKAGE } from '../scripts/pack-npm'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('pack-npm', () => {
  it.each(['0.0.0-test', '0.0.0-alpha.1'])('builds an isolated publishable CLI for %s', async (version) => {
    const outDir = join(HERE, '..', 'dist', 'npm-test-out')
    rmSync(outDir, { recursive: true, force: true })

    const result = await packNpm({ version, outDir })
    expect(result.packageName).toBe(PUBLIC_CLI_PACKAGE)
    expect(result.version).toBe(version)

    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8')) as {
      name: string
      version: string
      dependencies: Record<string, string>
      optionalDependencies: Record<string, string>
      bin: Record<string, string>
    }
    expect(pkg.name).toBe('@super-one/cli')
    expect(pkg.version).toBe(version)
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

    const bundle = readFileSync(join(outDir, 'lib', 'cli.mjs'), 'utf8')
    const channel = version.includes('-alpha') ? 'alpha' : 'stable'
    expect(bundle.indexOf(`process.env.SUPERONE_VARIANT = "${channel}";`)).toBeLessThan(bundle.indexOf('var DEFAULT_NODE_HOME'))
    expect(bundle).toContain(`process.env.SUPERONE_VARIANT = "${channel}";`)
    // Bundled CLI should not leave monorepo package names as bare imports.
    expect(bundle.includes('from "@superone/runtime"')).toBe(false)
    expect(bundle.includes('from "@superone/shared"')).toBe(false)
    // Cursor SDK must stay external (native/platform package, not rebundled).
    // It is loaded on first use, so the bundle references it by dynamic import.
    expect(bundle).toMatch(/(?:from |import\()["']@cursor\/sdk["']/)
    // Version inject for harness release coupling.
    expect(bundle.includes(version)).toBe(true)

    rmSync(outDir, { recursive: true, force: true })
  }, 60_000)
})
