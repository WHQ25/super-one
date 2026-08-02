import {
  createSimulatedTurnRunner,
  type TurnRunner,
} from '@superone/runtime/session'
import { createOpenCodeAppServerTurnRunner, type RunOpenCodeTurnOptions } from './run-turn'
import { isOpenCodeBinaryRunnable } from './server'

/**
 * Contract-compatible OpenCode turn runner for node / gateway parity tests.
 */
export function createSimulatedOpenCodeTurnRunner(opts?: {
  delayMs?: number
  chunks?: string[]
  requestPermission?: boolean
  emitStructuredEvents?: boolean
}): TurnRunner {
  return createSimulatedTurnRunner({
    delayMs: opts?.delayMs ?? 15,
    chunks: opts?.chunks ?? ['[opencode] ', 'done'],
    requestPermission: opts?.requestPermission,
    emitStructuredEvents: opts?.emitStructuredEvents,
  })
}

export interface CreateOpenCodeTurnRunnerOptions extends RunOpenCodeTurnOptions {
  allowSimulatedFallback?: boolean
  delayMs?: number
  /**
   * Resolve project registry path → host cwd.
   * Required for real serve turns; simulated path ignores it.
   */
  resolveProjectPath?: (projectId: string) => string | null
}

/**
 * Production entry: real `opencode serve` when a binary is available, else simulated.
 */
export function createOpenCodeTurnRunner(opts: CreateOpenCodeTurnRunnerOptions = {}): TurnRunner {
  const canRunReal = isOpenCodeBinaryRunnable(opts.binaryPath)
  if (canRunReal && opts.resolveProjectPath) {
    return createOpenCodeAppServerTurnRunner(opts.resolveProjectPath, {
      binaryPath: opts.binaryPath,
      serverUrl: opts.serverUrl,
      serverPassword: opts.serverPassword,
      env: opts.env,
      startupTimeoutMs: opts.startupTimeoutMs,
      superoneMcp: opts.superoneMcp,
      getSuperoneMcp: opts.getSuperoneMcp,
    })
  }
  if (opts.allowSimulatedFallback === false) {
    return async () => {
      throw new Error(
        'OpenCode runtime client not available on node: set SUPERONE_OPENCODE_BINARY or binaryPath, or enable simulated fallback',
      )
    }
  }
  return createSimulatedOpenCodeTurnRunner({ delayMs: opts.delayMs })
}
