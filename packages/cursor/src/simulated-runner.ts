import {
  createSimulatedTurnRunner,
  type TurnRunner,
} from '@superone/runtime/session'
import { isCursorSdkAvailable } from './cursor-sdk-available'
import { resolveCursorApiKeyPlain } from './cursor-config'
import { runCursorSdkTurn } from './run-sdk-turn'

/**
 * Contract-compatible Cursor turn runner for node / gateway parity tests.
 */
export function createSimulatedCursorTurnRunner(opts?: {
  delayMs?: number
  chunks?: string[]
  requestPermission?: boolean
  emitStructuredEvents?: boolean
}): TurnRunner {
  return createSimulatedTurnRunner({
    delayMs: opts?.delayMs ?? 15,
    chunks: opts?.chunks ?? ['[cursor] ', 'done'],
    requestPermission: opts?.requestPermission,
    emitStructuredEvents: opts?.emitStructuredEvents,
  })
}

export interface CreateCursorTurnRunnerOptions {
  allowSimulatedFallback?: boolean
  delayMs?: number
  /** Static API key (else env / getApiKey). */
  apiKey?: string
  /** Resolve API key dynamically (e.g. from credentials store). */
  getApiKey?: () => string | undefined
  /** Host user-data root for local agent SQLite store. */
  userDataRoot?: string
  /**
   * Resolve project registry path → host cwd.
   * Required for real SDK turns; simulated path ignores it.
   */
  resolveProjectPath?: (projectId: string) => string | null
}

/**
 * Production entry: real `@cursor/sdk` turn when API key + project path are
 * available, else simulated (unless allowSimulatedFallback === false).
 */
export function createCursorTurnRunner(opts: CreateCursorTurnRunnerOptions = {}): TurnRunner {
  const resolveApiKey = (): string | undefined => {
    if (opts.apiKey?.trim()) return opts.apiKey.trim()
    const fromGetter = opts.getApiKey?.()?.trim()
    if (fromGetter) return fromGetter
    return resolveCursorApiKeyPlain({})
  }

  if (opts.resolveProjectPath && isCursorSdkAvailable()) {
    const resolveProjectPath = opts.resolveProjectPath
    const userDataRoot = opts.userDataRoot?.trim()
      || process.env.SUPERONE_USER_DATA
      || process.cwd()

    return async (input) => {
      const key = resolveApiKey()
      if (!key) {
        if (opts.allowSimulatedFallback === false) {
          throw new Error(
            'Cursor User API Key missing. Set CURSOR_API_KEY or pass apiKey / getApiKey.',
          )
        }
        return createSimulatedCursorTurnRunner({ delayMs: opts.delayMs })(input)
      }
      const projectRoot =
        resolveProjectPath(input.session.projectId) ||
        process.env.SUPERONE_DEFAULT_CWD ||
        process.cwd()
      const cwd =
        input.session.cwd && input.session.cwd.trim()
          ? input.session.cwd.trim()
          : projectRoot

      return runCursorSdkTurn({
        apiKey: key,
        cwd,
        userDataRoot,
        model: input.model ?? undefined,
        permissionMode: input.permissionMode ?? undefined,
        providerResume: input.session.providerResume,
        prompt: input.text,
        messageId: input.messageId,
        onAgentEvent: input.onAgentEvent,
        signal: input.signal,
      })
    }
  }

  if (opts.allowSimulatedFallback === false) {
    return async () => {
      throw new Error(
        'Cursor SDK not available on node: set CURSOR_API_KEY (and resolveProjectPath), or enable simulated fallback',
      )
    }
  }
  return createSimulatedCursorTurnRunner({ delayMs: opts.delayMs })
}
