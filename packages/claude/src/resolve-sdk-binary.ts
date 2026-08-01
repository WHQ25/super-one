/**
 * Resolve the Claude Code executable bundled with @anthropic-ai/claude-agent-sdk
 * optional platform packages (same approach as desktop `claude-binary.ts`).
 *
 * When unset, the Agent SDK also self-resolves this path; we resolve early so
 * hosts can probe readiness without spawning a turn.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

let cached: string | null | undefined

/**
 * Path to the native Claude CLI shipped with the Agent SDK for this
 * platform/arch, or `null` if the optional dependency is missing.
 */
export function resolveSdkClaudeBinary(): string | null {
  if (cached !== undefined) return cached
  try {
    const req = createRequire(import.meta.url)
    const ext = process.platform === 'win32' ? '.exe' : ''
    const candidates =
      process.platform === 'linux'
        ? [
            `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/claude${ext}`,
            `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude${ext}`,
          ]
        : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${ext}`]
    for (const c of candidates) {
      try {
        let p = req.resolve(c)
        // Electron asar unpack (desktop thin-wrap later); harmless on CLI.
        if (p.includes('/app.asar/')) p = p.replace('/app.asar/', '/app.asar.unpacked/')
        if (p.includes('\\app.asar\\')) p = p.replace('\\app.asar\\', '\\app.asar.unpacked\\')
        if (existsSync(p)) {
          cached = p
          return p
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through
  }
  cached = null
  return null
}

/** Test helper: clear cached resolution. */
export function resetSdkClaudeBinaryCacheForTests(): void {
  cached = undefined
}
