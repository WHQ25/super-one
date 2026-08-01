/**
 * Production TurnRunner for node-hosted Claude (Stage 5-E).
 *
 * Uses `@superone/claude` → Claude Agent SDK `query()`. The SDK ships its
 * own platform binary via optionalDependencies; hosts do **not** need a global
 * `claude` install for turns.
 *
 * Binary resolution order:
 * 1. explicit `binaryPath` (tests / managed pin)
 * 2. `SUPERONE_CLAUDE_BINARY` (optional lab override)
 * 3. harness catalog `command` when claude is enabled
 * 4. Agent SDK bundled binary (`resolveSdkClaudeBinary`)
 *
 * Session create is allowed when any of the above resolves (see
 * `isClaudeRuntimeRunnable`).
 *
 * providerResume: `claude-session:<session_id>` for SDK `resume`.
 */

import { existsSync } from 'node:fs'
import {
  runClaudeSdkTurn,
  resolveSdkClaudeBinary,
  type ClaudeQueryFn,
} from '@superone/claude'
import { createSimulatedCodexRunner, type TurnRunner } from '@superone/runtime/session'
import type { HarnessManager } from './harness-manager'

export const CLAUDE_SESSION_RESUME_PREFIX = 'claude-session:'

export interface NodeClaudeRunnerOptions {
  binaryPath?: string | null
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessManager
  env?: NodeJS.ProcessEnv
  /** Injectable SDK query for tests (no real Claude process). */
  queryFn?: ClaudeQueryFn
  allowSimulatedFallback?: boolean
  /** Tests only: do not fall back to Agent SDK bundled binary. */
  skipSdkBinary?: boolean
}

export function resolveClaudeBinaryPath(opts: {
  binaryPath?: string | null
  harnesses?: HarnessManager
  skipSdkBinary?: boolean
}): string | null {
  if (opts.binaryPath && existsSync(opts.binaryPath)) return opts.binaryPath
  const fromEnv = process.env.SUPERONE_CLAUDE_BINARY?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const status = opts.harnesses?.get('claude')
  if (
    status?.enabled &&
    (status.state === 'ready' || status.state === 'needs_auth') &&
    status.command &&
    existsSync(status.command)
  ) {
    return status.command
  }
  if (opts.skipSdkBinary) return null
  // Default: Agent SDK optional platform package (same as desktop).
  return resolveSdkClaudeBinary()
}

/**
 * Whether session.create may target claude without a catalog-ready install.
 * True when an override path exists **or** the Agent SDK ships a binary.
 */
export function isClaudeRuntimeRunnable(): boolean {
  return resolveClaudeBinaryPath({}) != null
}

/**
 * @deprecated Use {@link isClaudeRuntimeRunnable}. Kept for call-site aliases.
 */
export function isClaudeBinaryOverrideRunnable(): boolean {
  return isClaudeRuntimeRunnable()
}

export function parseClaudeSessionResume(providerResume: string | null | undefined): string | null {
  if (!providerResume || !providerResume.startsWith(CLAUDE_SESSION_RESUME_PREFIX)) return null
  const id = providerResume.slice(CLAUDE_SESSION_RESUME_PREFIX.length).trim()
  return id.length > 0 ? id : null
}

export function formatClaudeSessionResume(sessionId: string | null | undefined): string | null {
  if (!sessionId || !sessionId.trim()) return null
  return `${CLAUDE_SESSION_RESUME_PREFIX}${sessionId.trim()}`
}

export function createNodeClaudeTurnRunner(opts: NodeClaudeRunnerOptions): TurnRunner {
  const simulatedClaude = createSimulatedCodexRunner({
    delayMs: 15,
    chunks: ['[claude] ', 'done'],
  })

  return async (input) => {
    const harnessId = input.session.harnessId || 'claude'
    if (harnessId !== 'claude') {
      throw new Error(
        `createNodeClaudeTurnRunner only handles harness claude (got ${harnessId})`,
      )
    }

    const binary = resolveClaudeBinaryPath({
      binaryPath: opts.binaryPath,
      harnesses: opts.harnesses,
      skipSdkBinary: opts.skipSdkBinary,
    })
    if (!binary) {
      if (opts.allowSimulatedFallback) return simulatedClaude(input)
      throw new Error(
        'Claude Agent SDK binary not available: reinstall optional platform package or set SUPERONE_CLAUDE_BINARY',
      )
    }

    const projectRoot =
      opts.resolveProjectPath(input.session.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const cwd =
      input.session.cwd && input.session.cwd.trim()
        ? input.session.cwd.trim()
        : projectRoot

    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
    }

    const priorSession = parseClaudeSessionResume(input.session.providerResume)

    const result = await runClaudeSdkTurn({
      binaryPath: binary,
      prompt: input.text,
      cwd,
      sessionId: priorSession,
      model: input.model && input.model.trim() ? input.model.trim() : undefined,
      env: authEnv,
      queryFn: opts.queryFn,
      onDelta: input.onDelta,
      onEvent: input.onEvent,
      onPermission: input.onPermission
        ? async (req) => {
            const decision = await input.onPermission!({
              interactionId: req.interactionId,
              kind: 'permission',
              toolName: req.toolName,
              toolUseId: req.toolUseId,
              input: req.input,
              createdAt: Date.now(),
            })
            return decision
          }
        : undefined,
      signal: input.signal,
    })

    return {
      finalText: result.finalText,
      providerResume: formatClaudeSessionResume(result.sessionId),
    }
  }
}
