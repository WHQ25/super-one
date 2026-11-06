/**
 * Resolve the Claude Code executable bundled with @anthropic-ai/claude-agent-sdk
 * optional platform packages. Desktop shares the uncached lookup below.
 *
 * When unset, the Agent SDK also self-resolves this path; we resolve early so
 * hosts can probe readiness without spawning a turn.
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'

let cached: string | null | undefined

/**
 * Path to the native Claude CLI shipped with the Agent SDK for this
 * platform/arch, or `null` if the optional dependency is missing.
 */
export function resolveSdkClaudeBinary(): string | null {
  if (cached !== undefined) return cached
  cached = findBundledClaudeBinary()
  return cached
}

/** Uncached so desktop can still discover packages installed after an earlier miss. */
export function findBundledClaudeBinary(): string | null {
  try {
    const req = createRequire(import.meta.url)
    const ext = process.platform === 'win32' ? '.exe' : ''
    const libc = process.platform === 'linux' && isMuslLinux() ? '-musl' : ''
    // An installed package is not necessarily runnable: both libc variants can
    // coexist in node_modules. Never fall back to the incompatible variant.
    let p = req.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libc}/claude${ext}`)
    if (p.includes('/app.asar/')) p = p.replace('/app.asar/', '/app.asar.unpacked/')
    if (p.includes('\\app.asar\\')) p = p.replace('\\app.asar\\', '\\app.asar.unpacked\\')
    if (existsSync(p)) return p
  } catch {
    // fall through
  }
  return null
}

function isMuslLinux(): boolean {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    if (report?.header) return !report.header.glibcVersionRuntime
  } catch {
    // Some hosts do not expose diagnostic reports; check their libc markers.
  }
  try {
    if (existsSync('/etc/alpine-release')) return true
  } catch { /* try the loader */ }
  try {
    return readdirSync('/lib').some(name => name.startsWith('ld-musl-'))
  } catch {
    return false
  }
}

/** Test helper: clear cached resolution. */
export function resetSdkClaudeBinaryCacheForTests(): void {
  cached = undefined
}
