import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codexPlatformVersion,
  createDesktopTarballInstaller,
  desktopPackagePins,
  installPackageDir,
  resolveDesktopManagedBinary,
  verifyNpmIntegrity,
} from './tarball-installer'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Build a minimal npm-style tarball (package/ + files) with system tar. */
function makeNpmTgz(work: string, files: Record<string, string | { mode?: number; body: string }>): {
  tgzPath: string
  bytes: Uint8Array
} {
  const pkg = join(work, 'package')
  mkdirSync(pkg, { recursive: true })
  for (const [rel, val] of Object.entries(files)) {
    const abs = join(pkg, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    if (typeof val === 'string') {
      writeFileSync(abs, val)
    } else {
      writeFileSync(abs, val.body)
      if (val.mode) chmodSync(abs, val.mode)
    }
  }
  const tgzPath = join(work, 'payload.tgz')
  // Parent of package/ so the archive contains package/...
  const r = spawnSync('tar', ['-czf', tgzPath, '-C', work, 'package'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`tar pack failed: ${r.stderr}`)
  const bytes = new Uint8Array(readFileSync(tgzPath))
  return { tgzPath, bytes }
}

describe('verifyNpmIntegrity', () => {
  it('accepts matching sha512', () => {
    const bytes = new TextEncoder().encode('hello')
    verifyNpmIntegrity(bytes, sha512Integrity(bytes))
  })

  it('rejects mismatch', () => {
    const bytes = new TextEncoder().encode('hello')
    expect(() => verifyNpmIntegrity(bytes, 'sha512-AAAAAAAAAAAAAAAAAAAAAA==')).toThrow(
      /integrity mismatch/,
    )
  })
})

describe('desktopPackagePins', () => {
  it('pins claude to the platform package only', () => {
    const pins = desktopPackagePins('claude')
    expect(pins.packages).toHaveLength(1)
    expect(pins.packages[0]!.name).toMatch(/claude-agent-sdk-/)
    expect(pins.packages[0]!.nodeModulesDir).toBe(pins.packages[0]!.name)
  })

  it('pins codex to @openai/codex with a platform-suffixed version', () => {
    const pins = desktopPackagePins('codex')
    expect(pins.packages[0]!.name).toBe('@openai/codex')
    expect(pins.packages[0]!.version).toBe(codexPlatformVersion())
    expect(pins.packages[0]!.version).toMatch(/-(darwin|linux|win32)-(arm64|x64)$/)
  })
})

describe('createDesktopTarballInstaller', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'so-harness-home-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('downloads, verifies, extracts, and returns the claude binary path', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk-test', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho ok\n', mode: 0o755 },
      })
      const integrity = sha512Integrity(bytes)
      const pins = desktopPackagePins('claude')
      const pkgName = pins.packages[0]!.name

      const installer = createDesktopTarballInstaller({
        fetchJson: async () => ({
          version: pins.packages[0]!.version,
          dist: { tarball: 'https://example.test/pkg.tgz', integrity },
        }),
        fetchBinary: async () => bytes,
      })

      const progress: Array<[number, number]> = []
      const result = await installer.install('claude', { root: home }, (r, t) => progress.push([r, t]))

      expect(result.source).toBe('npm-tarball')
      expect(result.command).toContain(pkgName.replace(/^@/, '').split('/')[0] === 'anthropic-ai'
        ? 'claude-agent-sdk'
        : pkgName)
      expect(existsSync(result.command)).toBe(true)
      // Second install reuses without re-fetch (would throw if fetchJson called again)
      let fetchCount = 0
      const installer2 = createDesktopTarballInstaller({
        fetchJson: async () => {
          fetchCount++
          throw new Error('should not fetch on reuse')
        },
        fetchBinary: async () => {
          fetchCount++
          throw new Error('should not fetch on reuse')
        },
      })
      const reused = await installer2.install('claude', { root: home })
      expect(reused.detail?.reused).toBe('1')
      expect(fetchCount).toBe(0)
      expect(resolveDesktopManagedBinary('claude', join(home, 'managed-npm', 'claude'))).toBe(
        result.command,
      )
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('rejects a tarball whose integrity does not match', async () => {
    const installer = createDesktopTarballInstaller({
      fetchJson: async () => ({
        version: '0.0.1',
        dist: { tarball: 'https://example.test/x.tgz', integrity: 'sha512-AAAA' },
      }),
      fetchBinary: async () => new TextEncoder().encode('not-matching'),
    })
    await expect(installer.install('claude', { root: home })).rejects.toThrow(/integrity mismatch/)
  })
})

describe('installPackageDir', () => {
  it('places package under scoped node_modules path', () => {
    const root = mkdtempSync(join(tmpdir(), 'so-pkg-'))
    try {
      const pkg = join(root, 'package')
      mkdirSync(pkg)
      writeFileSync(join(pkg, 'bin'), 'x')
      const prefix = join(root, 'prefix')
      const dest = installPackageDir(pkg, prefix, '@anthropic-ai/claude-agent-sdk-darwin-arm64')
      expect(dest).toBe(
        join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64'),
      )
      expect(existsSync(join(dest, 'bin'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
