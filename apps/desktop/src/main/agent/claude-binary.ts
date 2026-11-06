/**
 * Resolve the Claude Code native binary for pathToClaudeCodeExecutable.
 *
 * Order:
 * 1. SUPERONE_CLAUDE_BINARY env override
 * 2. Managed install under ~/.superone/harness (catalog / tarball)
 * 3. Local Agent SDK platform package — **dev / unpackaged only** (P5:
 *    packaged apps do not ship the binary)
 *
 * Spawn-time hard gate: use resolveHarnessRuntime('claude') from
 * ../harness/resolve-runtime when a missing runtime must surface as an
 * install prompt rather than a silent undefined.
 */

import { existsSync } from 'node:fs'
import { findBundledClaudeBinary } from '@superone/claude/resolve-sdk-binary'
import { managedHarnessPrefix } from '@superone/runtime/harness'
import { allowBundledHarnessPlatformPackages } from '../harness/bundled-fallback'
import { resolveHarnessHomeRoot } from '../harness/home'
import { resolveDesktopManagedBinary } from '../harness/tarball-installer'

/**
 * Only a *successful* resolution is cached. A miss must stay uncached: the
 * managed harness can finish installing later in the same process (upgrade
 * window), and a sticky negative would keep every caller failing until restart.
 * Re-resolving is a handful of existsSync calls.
 */
let cached: string | undefined

function resolveBundledSdkBinary(): string | undefined {
  if (!allowBundledHarnessPlatformPackages()) return undefined
  return findBundledClaudeBinary() ?? undefined
}

function resolveManagedClaudeBinary(): string | undefined {
  try {
    const prefix = managedHarnessPrefix(resolveHarnessHomeRoot(), 'claude')
    return resolveDesktopManagedBinary('claude', prefix) ?? undefined
  } catch {
    return undefined
  }
}

export function resolveSdkClaudeBinary(): string | undefined {
  if (cached) return cached

  const fromEnv = process.env.SUPERONE_CLAUDE_BINARY?.trim()
  if (fromEnv && existsSync(fromEnv)) {
    cached = fromEnv
    return fromEnv
  }

  const managed = resolveManagedClaudeBinary()
  if (managed) {
    cached = managed
    return managed
  }

  const bundled = resolveBundledSdkBinary()
  if (bundled) {
    cached = bundled
    return bundled
  }

  return undefined
}

/** Test helper: clear resolution cache after install / fixture changes. */
export function resetClaudeBinaryCacheForTests(): void {
  cached = undefined
}
