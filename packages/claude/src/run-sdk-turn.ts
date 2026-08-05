/**
 * One Claude turn via the official Agent SDK (`query`).
 *
 * Electron-free shared core for desktop and CLI:
 * - pathToClaudeCodeExecutable + resume
 * - canUseTool → host onPermission
 * - SDK message stream → lossless AgentEvent (preferred) or legacy SessionTurnEvent
 */

import { existsSync } from 'node:fs'
import { query as sdkQuery, type CanUseTool, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { SessionTurnEvent } from '@superone/shared/environment'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'
import { isStaticHostOwnedSuperoneToolQualified } from '@superone/shared/superone-host-owned-tools'
import { applySdkMessage, createSdkMapState } from './map-sdk-message'
import { createClaudeAgentEventMapper } from './agent-event-mapper'
import { resolveSdkClaudeBinary } from './resolve-sdk-binary'
import type {
  ClaudePermissionHandler,
  ClaudePlanHandler,
  ClaudeQuestionHandler,
  ClaudeSdkTurnResult,
  RunClaudeSdkTurnOptions,
} from './types'

const DEFAULT_TEXT_BLOCK_ID = 'assistant-text'

function buildCanUseTool(
  onPermission: ClaudePermissionHandler | undefined,
  onQuestion: ClaudeQuestionHandler | undefined,
  onPlan: ClaudePlanHandler | undefined,
  signal: AbortSignal,
  timing: { pausedMs: number },
): CanUseTool {
  return async (toolName, input, options) => {
    if (signal.aborted || options.signal.aborted) {
      return {
        behavior: 'deny',
        message: 'Permission aborted',
      }
    }
    // Host-owned SuperOne MCP tools (session_rename, widget_show, …) never prompt.
    if (isStaticHostOwnedSuperoneToolQualified(toolName)) {
      return { behavior: 'allow' }
    }
    const interactionId =
      (typeof options.requestId === 'string' && options.requestId) ||
      (typeof options.toolUseID === 'string' && options.toolUseID) ||
      `interaction_${Date.now()}`
    if (toolName === 'AskUserQuestion') {
      if (!onQuestion) {
        return { behavior: 'deny', message: 'Question denied by SuperOne node (no question handler)' }
      }
      const answer = await onQuestion({
        interactionId,
        kind: 'question',
        toolName,
        toolUseId: typeof options.toolUseID === 'string' ? options.toolUseID : undefined,
        input: input && typeof input === 'object' ? input : undefined,
      })
      const record = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null
      const answers = record && 'answers' in record ? record.answers : answer
      return {
        behavior: 'allow',
        updatedInput: {
          ...(input && typeof input === 'object' ? input : {}),
          answers,
          ...(record && record.annotations !== undefined ? { annotations: record.annotations } : {}),
        },
      }
    }
    if (toolName === 'ExitPlanMode') {
      if (!onPlan) {
        return { behavior: 'deny', message: 'Plan denied by SuperOne node (no plan handler)' }
      }
      const result = await onPlan({
        interactionId,
        kind: 'plan',
        toolName,
        toolUseId: typeof options.toolUseID === 'string' ? options.toolUseID : undefined,
        input: input && typeof input === 'object' ? input : undefined,
      })
      if (result.decision === 'approve') return { behavior: 'allow', updatedInput: input }
      const feedback = result.options?.feedback
      return {
        behavior: 'deny',
        message: typeof feedback === 'string' && feedback ? feedback : 'User rejected the plan',
      }
    }
    if (!onPermission) {
      return {
        behavior: 'deny',
        message: 'Permission denied by SuperOne node (no permission handler)',
      }
    }
    const startedAt = Date.now()
    const decision = await onPermission({
      interactionId,
      toolName,
      toolUseId: typeof options.toolUseID === 'string' ? options.toolUseID : undefined,
      input: input && typeof input === 'object' ? input : undefined,
    }).finally(() => {
      timing.pausedMs += Date.now() - startedAt
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

function buildOptions(opts: RunClaudeSdkTurnOptions, timing: { pausedMs: number }): Options {
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

  const effort =
    opts.effort === 'low' ||
    opts.effort === 'medium' ||
    opts.effort === 'high' ||
    opts.effort === 'xhigh' ||
    opts.effort === 'max'
      ? opts.effort
      : undefined

  const base: Options = {
    cwd: opts.cwd,
    // Omit when unresolved — SDK query() self-resolves optional platform package.
    ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
    model: opts.model,
    ...(effort ? { effort } : {}),
    includePartialMessages: true,
    thinking: { type: 'adaptive', display: 'summarized' },
    promptSuggestions: true,
    forwardSubagentText: true,
    enableFileCheckpointing: true,
    agentProgressSummaries: true,
    extraArgs: { 'replay-user-messages': null },
    permissionMode: (opts.permissionMode as Options['permissionMode']) || 'default',
    allowDangerouslySkipPermissions: true,
    canUseTool: buildCanUseTool(
      opts.onPermission,
      opts.onQuestion,
      opts.onPlan,
      opts.signal,
      timing,
    ),
    abortController,
    settingSources: ['user', 'project', 'local'],
    ...(opts.additionalDirectories && opts.additionalDirectories.length > 0
      ? { additionalDirectories: opts.additionalDirectories }
      : {}),
    ...(opts.enabledSkills && opts.enabledSkills.length > 0
      ? { skills: opts.enabledSkills }
      : {}),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [SUPERONE_SYSTEM_PROMPT_APPEND, opts.systemPromptAppend]
        .filter(Boolean)
        .join('\n\n'),
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

  const useAgentEvents = typeof opts.onAgentEvent === 'function'
  const useOnEvent = typeof opts.onEvent === 'function' && !useAgentEvents
  const textBlockId = opts.defaultTextBlockId ?? DEFAULT_TEXT_BLOCK_ID
  const state = createSdkMapState(textBlockId)
  const timing = { pausedMs: 0 }
  const agentEventMapper = opts.onAgentEvent
    ? createClaudeAgentEventMapper({
        messageId: opts.messageId ?? textBlockId,
        emit: opts.onAgentEvent,
        startedAt: Date.now(),
        pausedMs: () => timing.pausedMs,
        isInterrupted: () => opts.signal.aborted,
      })
    : null
  let streamedText = ''
  let lastSessionId: string | null = opts.sessionId ?? null
  let finalText = ''

  const emitEvent = (event: SessionTurnEvent) => {
    opts.onEvent?.(event)
  }

  const emitTextDelta = (delta: string) => {
    streamedText += delta
    if (useAgentEvents) {
      // The AgentEvent mapper already emitted this text delta losslessly.
    } else if (useOnEvent) {
      emitEvent({ kind: 'text', blockId: textBlockId, delta })
    } else {
      opts.onDelta?.(delta)
    }
  }

  const emitTextFinal = (text: string) => {
    if (useAgentEvents) {
      // Result/message lifecycle is emitted by the AgentEvent mapper.
    } else if (useOnEvent) {
      emitEvent({ kind: 'text', blockId: textBlockId, final: true, text })
    } else if (text && !streamedText) {
      opts.onDelta?.(text)
    }
  }

  if (useOnEvent) {
    emitEvent({ kind: 'status', status: 'streaming' })
  }

  const options = buildOptions(opts, timing)
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

      const applied = agentEventMapper
        ? agentEventMapper.apply(msg)
        : applySdkMessage(msg, state, emitEvent)
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
