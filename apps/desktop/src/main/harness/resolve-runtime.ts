/**
 * Spawn-time gate for managed harness runtimes.
 *
 * Replaces scattered require.resolve call sites: one entry that either returns
 * an absolute binary path or throws a structured HarnessNotReadyError the
 * renderer can turn into an install prompt.
 */

import { existsSync } from 'node:fs'
import type { NodeHarnessId } from '@superone/shared/environment'
import type { HarnessInstallState } from '@superone/shared/environment'
import { getHarnessManager } from './service'
import { desktopHarnessResolver } from './host'

export class HarnessNotReadyError extends Error {
  readonly code = 'HARNESS_NOT_READY' as const
  readonly harnessId: NodeHarnessId
  readonly state: HarnessInstallState
  readonly enabled: boolean

  constructor(opts: {
    harnessId: NodeHarnessId
    state: HarnessInstallState
    enabled: boolean
    message?: string
  }) {
    super(
      opts.message ??
        `Harness ${opts.harnessId} is not ready (enabled=${opts.enabled}, state=${opts.state})`,
    )
    this.name = 'HarnessNotReadyError'
    this.harnessId = opts.harnessId
    this.state = opts.state
    this.enabled = opts.enabled
  }
}

export function isHarnessNotReadyError(err: unknown): err is HarnessNotReadyError {
  return err instanceof HarnessNotReadyError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'HARNESS_NOT_READY')
}

/**
 * Resolve a runnable absolute path for a managed harness binary.
 *
 * Order (via desktopHarnessResolver):
 * 1. env override
 * 2. catalog command (prior enable)
 * 3. managed install under ~/.superone/harness
 * 4. local platform package (dev / unpackaged only — never in packaged app)
 * 5. PATH (codex only)
 *
 * Throws HarnessNotReadyError when nothing resolves — callers must not fall
 * back to a generic "spawn failed" path.
 */
export function resolveHarnessRuntime(id: 'claude' | 'codex'): string {
  const manager = getHarnessManager()
  const path = desktopHarnessResolver.resolveBinary(id, manager)
  if (path && existsSync(path)) return path

  const status = manager.get(id)
  throw new HarnessNotReadyError({
    harnessId: id,
    state: status.state,
    enabled: status.enabled,
    message:
      status.state === 'installing'
        ? `Harness ${id} is still installing`
        : status.enabled
          ? `Harness ${id} is enabled but runtime is missing (state=${status.state})`
          : `Harness ${id} is not enabled — install it from Settings → Harnesses`,
  })
}

/** Soft probe — null when not ready (no throw). */
export function tryResolveHarnessRuntime(id: 'claude' | 'codex'): string | null {
  try {
    return resolveHarnessRuntime(id)
  } catch (err) {
    if (isHarnessNotReadyError(err)) return null
    throw err
  }
}
