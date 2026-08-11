import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_CLAUDE_SDK_PACKAGE,
  OFFICIAL_CODEX_PACKAGE,
  OFFICIAL_CODEX_NPM_VERSION,
  OFFICIAL_CLAUDE_SDK_VERSION,
  claudePlatformPackageName,
  installManagedFromOfficialNpm,
  managedHarnessPrefix,
  officialPackageSpecs,
  resolveOfficialInstallBinary,
  resolveOfficialInstallBinaryInRoot,
} from './managed-harness-official'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('officialPackageSpecs', () => {
  it('pins Claude SDK + platform package to the same version', () => {
    const { specs, runtimeVersion } = officialPackageSpecs('claude')
    expect(runtimeVersion).toBe(OFFICIAL_CLAUDE_SDK_VERSION)
    expect(specs).toHaveLength(2)
    expect(specs[0]).toBe(`${OFFICIAL_CLAUDE_SDK_PACKAGE}@${OFFICIAL_CLAUDE_SDK_VERSION}`)
    expect(specs[1]).toMatch(new RegExp(`^@anthropic-ai/claude-agent-sdk-.+@${OFFICIAL_CLAUDE_SDK_VERSION}$`))
  })

  it('pins Codex from @openai/codex', () => {
    const { specs, runtimeVersion } = officialPackageSpecs('codex')
    expect(runtimeVersion).toBe(OFFICIAL_CODEX_NPM_VERSION)
    expect(specs).toEqual([`${OFFICIAL_CODEX_PACKAGE}@${OFFICIAL_CODEX_NPM_VERSION}`])
  })

  it('honours version env overrides', () => {
    const prevC = process.env.SUPERONE_CLAUDE_SDK_VERSION
    const prevX = process.env.SUPERONE_CODEX_NPM_VERSION
    try {
      process.env.SUPERONE_CLAUDE_SDK_VERSION = '9.9.9'
      process.env.SUPERONE_CODEX_NPM_VERSION = '8.8.8'
      expect(officialPackageSpecs('claude').specs[0]).toBe(`${OFFICIAL_CLAUDE_SDK_PACKAGE}@9.9.9`)
      expect(officialPackageSpecs('codex').specs[0]).toBe(`${OFFICIAL_CODEX_PACKAGE}@8.8.8`)
    } finally {
      if (prevC === undefined) delete process.env.SUPERONE_CLAUDE_SDK_VERSION
      else process.env.SUPERONE_CLAUDE_SDK_VERSION = prevC
      if (prevX === undefined) delete process.env.SUPERONE_CODEX_NPM_VERSION
      else process.env.SUPERONE_CODEX_NPM_VERSION = prevX
    }
  })
})

describe('claudePlatformPackageName', () => {
  it('returns a scoped platform package for this host', () => {
    const name = claudePlatformPackageName()
    expect(name.startsWith('@anthropic-ai/claude-agent-sdk-')).toBe(true)
  })
})

describe('resolveOfficialInstallBinary', () => {
  it('finds codex under a concrete install root (InRoot)', () => {
    const root = mkdtempSync(join(tmpdir(), 'off-codex-'))
    mkdirSync(join(root, 'bin'), { recursive: true })
    const bin = join(root, 'bin', 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    expect(resolveOfficialInstallBinaryInRoot('codex', root)).toBe(bin)
  })

  it('finds claude under a concrete install root (InRoot)', () => {
    const root = mkdtempSync(join(tmpdir(), 'off-claude-'))
    const pkgDir = join(root, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64')
    mkdirSync(pkgDir, { recursive: true })
    const bin = join(pkgDir, 'claude')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    expect(resolveOfficialInstallBinaryInRoot('claude', root)).toBe(bin)
  })

  it('follows harness prefix current → versions/<ver>', () => {
    const prefix = mkdtempSync(join(tmpdir(), 'off-prefix-'))
    const verDir = join(prefix, 'versions', '1.0.0')
    const pkgDir = join(verDir, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64')
    mkdirSync(pkgDir, { recursive: true })
    const bin = join(pkgDir, 'claude')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    writeFileSync(join(prefix, 'current'), JSON.stringify({ runtimeVersion: '1.0.0' }))
    expect(resolveOfficialInstallBinary('claude', prefix)).toBe(bin)
  })
})

describe('managedHarnessPrefix', () => {
  it('places harness id directly under home root', () => {
    expect(managedHarnessPrefix('/tmp/harness', 'claude')).toBe(join('/tmp/harness', 'claude'))
  })
})

describe('installManagedFromOfficialNpm', () => {
  it('installs codex via injected npm and resolves bin', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'off-inst-'))
    let npmArgs: string[] = []
    const result = await installManagedFromOfficialNpm({
      nodeHome,
      harnessId: 'codex',
      runNpm: async (args, cwd) => {
        npmArgs = args
        const prefix = args[args.indexOf('--prefix') + 1]!
        expect(cwd).toBe(prefix)
        mkdirSync(join(prefix, 'bin'), { recursive: true })
        const bin = join(prefix, 'bin', 'codex')
        writeFileSync(bin, '#!/bin/sh\n')
        chmodSync(bin, 0o755)
        mkdirSync(join(prefix, 'lib', 'node_modules', '@openai', 'codex'), { recursive: true })
        writeFileSync(
          join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'package.json'),
          JSON.stringify({ version: OFFICIAL_CODEX_NPM_VERSION }),
        )
      },
    })
    expect(npmArgs).toContain('install')
    expect(npmArgs.some((a) => a.startsWith(`${OFFICIAL_CODEX_PACKAGE}@`))).toBe(true)
    expect(result.source).toBe('official-npm')
    expect(result.command).toContain(`${join('bin', 'codex')}`)
    expect(result.runtimeVersion).toBe(OFFICIAL_CODEX_NPM_VERSION)
    // Shared versioned layout with desktop
    expect(result.installPrefix).toContain(join('versions', OFFICIAL_CODEX_NPM_VERSION))
    expect(result.command).toContain(join('versions', OFFICIAL_CODEX_NPM_VERSION))
  })
})

