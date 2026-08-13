/**
 * Locate Cursor SDK platform helpers (cursorsandbox, rg, tree-sitter).
 *
 * `@cursor/sdk` finds these by walking up from `process.argv[1]` / `execPath`
 * and refuses workspace-local copies on the execPath walk. Electron's argv[1]
 * is often a flag or an asar path, so the walk misses
 * `node_modules/@cursor/sdk-<platform>/bin/cursorsandbox` and Agent.create
 * throws when sandboxOptions.enabled is true.
 *
 * We resolve the optional platform package ourselves (asar.unpacked aware)
 * and temporarily point argv[1] at it so the SDK's locator succeeds.
 */

import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requireFromHere = createRequire(import.meta.url)

export function cursorPlatformPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `@cursor/sdk-${platform}-${arch}`
}

export function toUnpackedAsarPath(filePath: string): string {
  return filePath
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

function isExecutableFile(candidate: string): boolean {
  try {
    const st = statSync(candidate)
    if (!st.isFile()) return false
    if (process.platform === 'win32') return true
    return (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function cursorSdkRequire(): NodeRequire {
  try {
    return createRequire(requireFromHere.resolve('@cursor/sdk/package.json'))
  } catch {
    return requireFromHere
  }
}

export function resolveCursorPlatformRoot(): string | null {
  const name = cursorPlatformPackageName()
  const req = cursorSdkRequire()
  try {
    const pkgJson = toUnpackedAsarPath(req.resolve(`${name}/package.json`))
    return existsSync(pkgJson) ? dirname(pkgJson) : null
  } catch {
    return null
  }
}

function platformBinName(base: 'cursorsandbox' | 'rg'): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

export function resolveCursorSandboxBinary(): string | null {
  const root = resolveCursorPlatformRoot()
  if (!root) return null
  const bin = join(root, 'bin', platformBinName('cursorsandbox'))
  return isExecutableFile(bin) ? bin : null
}

export function resolveCursorRipgrepBinary(): string | null {
  const root = resolveCursorPlatformRoot()
  if (!root) return null
  const bin = join(root, 'bin', platformBinName('rg'))
  return isExecutableFile(bin) ? bin : null
}

export function resolveCursorTreeSitterVendorDir(): string | null {
  const root = resolveCursorPlatformRoot()
  if (!root) return null
  const vendor = join(root, 'vendor')
  return existsSync(join(vendor, 'tree-sitter', 'index.js')) ? vendor : null
}

export interface CursorSandboxSupportProbe {
  platform?: NodeJS.Platform
  sandboxBinary?: string | null
  sandboxExecExists?: boolean
}

function sandboxExecAvailable(): boolean {
  try {
    statSync('/usr/bin/sandbox-exec')
    return true
  } catch {
    return false
  }
}

/**
 * Whether Cursor's *local* filesystem sandbox can be requested.
 * Windows helper is network-proxy only — the SDK still throws if enabled.
 */
export function isCursorLocalSandboxSupported(probe: CursorSandboxSupportProbe = {}): boolean {
  const platform = probe.platform ?? process.platform
  if (platform === 'win32') return false
  const binary = probe.sandboxBinary !== undefined
    ? probe.sandboxBinary
    : resolveCursorSandboxBinary()
  if (!binary) return false
  if (platform === 'darwin') {
    const execOk = probe.sandboxExecExists ?? sandboxExecAvailable()
    return execOk
  }
  return true
}

export function resolveCursorSandboxEnabled(
  requested: boolean,
  probe?: CursorSandboxSupportProbe,
): boolean {
  return requested && isCursorLocalSandboxSupported(probe)
}

export function isCursorSandboxUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /sandboxing is not supported/i.test(message)
}

let lookupDepth = 0
let savedArgv1: string | undefined

function primeHelperEnv(): void {
  if (!process.env.CURSOR_RIPGREP_PATH) {
    const rg = resolveCursorRipgrepBinary()
    if (rg) process.env.CURSOR_RIPGREP_PATH = rg
  }
  if (!process.env.CURSOR_TREE_SITTER_VENDOR_DIR) {
    const vendor = resolveCursorTreeSitterVendorDir()
    if (vendor) process.env.CURSOR_TREE_SITTER_VENDOR_DIR = vendor
  }
}

function beginPlatformLookup(): () => void {
  if (lookupDepth === 0) {
    savedArgv1 = process.argv[1]
    const root = resolveCursorPlatformRoot()
    if (root) process.argv[1] = join(root, 'package.json')
    primeHelperEnv()
  }
  lookupDepth += 1
  return () => {
    lookupDepth = Math.max(0, lookupDepth - 1)
    if (lookupDepth === 0 && savedArgv1 !== undefined) {
      process.argv[1] = savedArgv1
      savedArgv1 = undefined
    }
  }
}

export function withCursorPlatformLookup<T>(fn: () => Promise<T>): Promise<T>
export function withCursorPlatformLookup<T>(fn: () => T): T
export function withCursorPlatformLookup<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const restore = beginPlatformLookup()
  try {
    const result = fn()
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}
