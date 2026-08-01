/**
 * One Claude turn via the official Agent SDK (`query`).
 *
 * Electron-free shared core for desktop and CLI:
 * - pathToClaudeCodeExecutable + resume
 * - canUseTool → host onPermission
 * - SDK message stream → SessionTurnEvent (onEvent)
 */

import { existsSync } from 'node:fs'
import { query as sdkQuery, type CanUseTool, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { SessionTurnEvent } from '@superone/shared/environment'
import { applySdkMessage, createSdkMapState } from './map-sdk-message'
import { resolveSdkClaudeBinary } from './resolve-sdk-binary'
import type {
  ClaudePermissionHandler,
  ClaudeSdkTurnResult,
  RunClaudeSdkTurnOptions,
} from './types'

const DEFAULT_TEXT_BLOCK_ID = 'assistant-text'

function buildCanUseTool(
  onPermission: ClaudePermissionHandler | undefined,
  signal: AbortSignal,
): CanUseTool {
  return async (toolName, input, options) => {
    if (signal.aborted || options.signal.aborted) {
      return {
        behavior: 'deny',
        message: 'Permission aborted',
      }
    }
    if (!onPermission) {
      return {
        behavior: 'deny',
        message: 'Permission denied by SuperOne node (no permission handler)',
      }
    }
    const interactionId =
      (typeof options.requestId === 'string' && options.requestId) ||
      (typeof options.toolUseID === 'string' && options.toolUseID) ||
      `perm_${Date.now()}`
    const decision = await onPermission({
      interactionId,
      toolName,
      toolUseId: typeof options.toolUseID === 'string' ? options.toolUseID : undefined,
      input: input && typeof input === 'object' ? input : undefined,
    })
    if (decision === 'allow') {
      return { behavior: 'allow' }
    }
    return {
      behavior: 'deny',
      message: 'Permission denied by SuperOne node',
    }
  }
}

function buildOptions(opts: RunClaudeSdkTurnOptions): Options {
  const abortController = new AbortController()
  if (opts.signal.aborted) {
    abortController.abort()
  } else {
    opts.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  const env = opts.env
    ? ({ ...process.env, ...opts.env } as Record<string, string | undefined>)
    : undefined

  const binaryPath =
    (opts.binaryPath && existsSync(opts.binaryPath) ? opts.binaryPath : null) ??
    resolveSdkClaudeBinary() ??
    undefined

  const base: Options = {
    cwd: opts.cwd,
    // Omit when unresolved — SDK query() self-resolves optional platform package.
    ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
    model: opts.model,
    includePartialMessages: true,
    permissionMode: 'default',
    canUseTool: buildCanUseTool(opts.onPermission, opts.signal),
    abortController,
    settingSources: ['user', 'project', 'local'],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
    },
    ...(opts.sessionId ? { resume: opts.sessionId } : {}),
    ...(env ? { env } : {}),
  }

  return {
    ...base,
    ...(opts.options ?? {}),
    // Ensure host canUseTool / abort are not wiped by partial overrides unless explicit.
    canUseTool: opts.options?.canUseTool ?? base.canUseTool,
    abortController: opts.options?.abortController ?? base.abortController,
  }
}

export async function runClaudeSdkTurn(
  opts: RunClaudeSdkTurnOptions,
): Promise<ClaudeSdkTurnResult> {
  if (opts.signal.aborted) {
    throw new Error('Claude turn interrupted')
  }
  const resolvedBinary =
    (opts.binaryPath && existsSync(opts.binaryPath) ? opts.binaryPath : null) ??
    resolveSdkClaudeBinary()
  // Explicit path that does not exist is a hard error; missing SDK optional
  // package also fails closed (SDK would throw the same at query() time).
  if (opts.binaryPath && !existsSync(opts.binaryPath)) {
    throw new Error(`Claude binary not found: ${opts.binaryPath}`)
  }
  if (!resolvedBinary) {
    throw new Error(
      'Claude Agent SDK binary not found: reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set pathToClaudeCodeExecutable / SUPERONE_CLAUDE_BINARY',
    )
  }

  const useOnEvent = typeof opts.onEvent === 'function'
  const textBlockId = opts.defaultTextBlockId ?? DEFAULT_TEXT_BLOCK_ID
  const state = createSdkMapState(textBlockId)
  let streamedText = ''
  let lastSessionId: string | null = opts.sessionId ?? null
  let finalText = ''

  const emitEvent = (event: SessionTurnEvent) => {
    opts.onEvent?.(event)
  }

  const emitTextDelta = (delta: string) => {
    streamedText += delta
    if (useOnEvent) {
      emitEvent({ kind: 'text', blockId: textBlockId, delta })
    } else {
      opts.onDelta?.(delta)
    }
  }

  const emitTextFinal = (text: string) => {
    if (useOnEvent) {
      emitEvent({ kind: 'text', blockId: textBlockId, final: true, text })
    } else if (text && !streamedText) {
      opts.onDelta?.(text)
    }
  }

  if (useOnEvent) {
    emitEvent({ kind: 'status', status: 'streaming' })
  }

  const options = buildOptions(opts)
  const queryFn = opts.queryFn ?? sdkQuery
  const q = queryFn({ prompt: opts.prompt, options })

  let resultError: string | null = null
  let sawResult = false

  try {
    for await (const msg of q) {
      if (opts.signal.aborted) {
        try {
          if (typeof (q as { close?: () => void }).close === 'function') {
            ;(q as { close: () => void }).close()
          }
        } catch {
          // ignore close errors on abort
        }
        throw new Error('Claude turn interrupted')
      }

      const applied = applySdkMessage(msg, state, emitEvent)
      if (applied.sessionId) lastSessionId = applied.sessionId
      if (applied.textDelta) emitTextDelta(applied.textDelta)

      if (applied.isResult) {
        sawResult = true
        if (applied.resultIsError) {
          resultError = applied.resultError || 'Claude turn failed'
        } else {
          finalText =
            applied.resultText ??
            (streamedText.length > 0 ? streamedText : finalText)
        }
      }
    }
  } catch (err) {
    if (opts.signal.aborted) {
      throw new Error('Claude turn interrupted')
    }
    try {
      if (typeof (q as { close?: () => void }).close === 'function') {
        ;(q as { close: () => void }).close()
      }
    } catch {
      // ignore
    }
    throw err instanceof Error ? err : new Error(String(err))
  }

  if (resultError) {
    if (useOnEvent) {
      emitEvent({ kind: 'status', status: 'error', message: resultError })
    }
    throw new Error(resultError)
  }

  if (!sawResult && !finalText && streamedText) {
    finalText = streamedText
  }
  if (!finalText && streamedText) finalText = streamedText

  emitTextFinal(finalText)

  if (useOnEvent) {
    emitEvent({ kind: 'status', status: 'idle' })
  }

  return {
    finalText,
    sessionId: lastSessionId,
  }
}
