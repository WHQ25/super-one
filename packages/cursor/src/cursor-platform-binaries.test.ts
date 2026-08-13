import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cursorPlatformPackageName,
  isCursorLocalSandboxSupported,
  isCursorSandboxUnsupportedError,
  resolveCursorRipgrepBinary,
  resolveCursorSandboxBinary,
  resolveCursorSandboxEnabled,
  toUnpackedAsarPath,
  withCursorPlatformLookup,
} from './cursor-platform-binaries'

describe('cursor-platform-binaries', () => {
  const originalArgv1 = process.argv[1]
  const originalRipgrep = process.env.CURSOR_RIPGREP_PATH
  const originalVendor = process.env.CURSOR_TREE_SITTER_VENDOR_DIR

  afterEach(() => {
    process.argv[1] = originalArgv1
    if (originalRipgrep === undefined) delete process.env.CURSOR_RIPGREP_PATH
    else process.env.CURSOR_RIPGREP_PATH = originalRipgrep
    if (originalVendor === undefined) delete process.env.CURSOR_TREE_SITTER_VENDOR_DIR
    else process.env.CURSOR_TREE_SITTER_VENDOR_DIR = originalVendor
  })

  it('names the optional platform package from os/arch', () => {
    expect(cursorPlatformPackageName('darwin', 'arm64')).toBe('@cursor/sdk-darwin-arm64')
    expect(cursorPlatformPackageName('win32', 'x64')).toBe('@cursor/sdk-win32-x64')
    expect(cursorPlatformPackageName('linux', 'arm64')).toBe('@cursor/sdk-linux-arm64')
  })

  it('remaps asar paths to the unpacked sibling', () => {
    expect(toUnpackedAsarPath('/App/Resources/app.asar/node_modules/@cursor/sdk/package.json'))
      .toBe('/App/Resources/app.asar.unpacked/node_modules/@cursor/sdk/package.json')
    expect(toUnpackedAsarPath('C:\\App\\resources\\app.asar\\node_modules\\x'))
      .toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\x')
    expect(toUnpackedAsarPath('/plain/node_modules/x')).toBe('/plain/node_modules/x')
  })

  it('detects the SDK sandbox-unsupported error', () => {
    expect(isCursorSandboxUnsupportedError(
      new Error('Local SDK sandboxing was requested, but sandboxing is not supported in this environment. Disable local.sandboxOptions.enabled or remove ~/.cursor/sandbox.json to run without sandboxing.'),
    )).toBe(true)
    expect(isCursorSandboxUnsupportedError(new Error('API key missing'))).toBe(false)
    expect(isCursorSandboxUnsupportedError('sandboxing is not supported')).toBe(true)
  })

  it('never enables sandbox on Windows', () => {
    expect(isCursorLocalSandboxSupported({
      platform: 'win32',
      sandboxBinary: '/tmp/cursorsandbox.exe',
      sandboxExecExists: true,
    })).toBe(false)
    expect(resolveCursorSandboxEnabled(true, {
      platform: 'win32',
      sandboxBinary: '/tmp/cursorsandbox.exe',
      sandboxExecExists: true,
    })).toBe(false)
  })

  it('requires the helper binary (and sandbox-exec on macOS)', () => {
    expect(isCursorLocalSandboxSupported({
      platform: 'darwin',
      sandboxBinary: null,
      sandboxExecExists: true,
    })).toBe(false)
    expect(isCursorLocalSandboxSupported({
      platform: 'darwin',
      sandboxBinary: '/usr/local/bin/cursorsandbox',
      sandboxExecExists: false,
    })).toBe(false)
    expect(isCursorLocalSandboxSupported({
      platform: 'darwin',
      sandboxBinary: '/usr/local/bin/cursorsandbox',
      sandboxExecExists: true,
    })).toBe(true)
    expect(isCursorLocalSandboxSupported({
      platform: 'linux',
      sandboxBinary: '/usr/local/bin/cursorsandbox',
      sandboxExecExists: false,
    })).toBe(true)
  })

  it('resolves the hoisted platform binaries in this install', () => {
    const sandbox = resolveCursorSandboxBinary()
    const rg = resolveCursorRipgrepBinary()
    if (process.platform === 'win32') {
      expect(sandbox === null || sandbox.endsWith('cursorsandbox.exe')).toBe(true)
      return
    }
    expect(sandbox).toBeTruthy()
    expect(sandbox).toMatch(/cursorsandbox$/)
    expect(existsSync(sandbox!)).toBe(true)
    expect(rg).toBeTruthy()
    expect(existsSync(rg!)).toBe(true)
  })

  it('points argv[1] at the platform package during lookup and restores it', async () => {
    const before = process.argv[1]
    let seen: string | undefined
    const result = await withCursorPlatformLookup(async () => {
      seen = process.argv[1]
      return 7
    })
    expect(result).toBe(7)
    expect(process.argv[1]).toBe(before)
    const sandbox = resolveCursorSandboxBinary()
    if (sandbox) {
      expect(seen).toContain('@cursor/sdk-')
      expect(seen).toMatch(/package\.json$/)
    }
  })

  it('makes the SDK-style node_modules walk find cursorsandbox from argv[1]', async () => {
    const sandbox = resolveCursorSandboxBinary()
    if (!sandbox) return
    await withCursorPlatformLookup(async () => {
      const start = dirname(resolve(process.argv[1] ?? ''))
      const pkg = cursorPlatformPackageName()
      const name = process.platform === 'win32' ? 'cursorsandbox.exe' : 'cursorsandbox'
      let dir = start
      let found: string | null = null
      for (let i = 0; i < 12; i++) {
        const candidate = join(dir, 'node_modules', pkg, 'bin', name)
        if (existsSync(candidate)) {
          found = candidate
          break
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      expect(found).toBeTruthy()
      expect(found).toBe(sandbox)
    })
  })

  it('restores argv[1] when the lookup callback throws', async () => {
    const before = process.argv[1]
    await expect(withCursorPlatformLookup(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(process.argv[1]).toBe(before)
  })

  it('leaves a caller-set CURSOR_RIPGREP_PATH untouched', async () => {
    process.env.CURSOR_RIPGREP_PATH = '/custom/rg'
    await withCursorPlatformLookup(() => undefined)
    expect(process.env.CURSOR_RIPGREP_PATH).toBe('/custom/rg')
  })
})
