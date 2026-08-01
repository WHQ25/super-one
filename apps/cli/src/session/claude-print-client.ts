/**
 * Minimal Electron-free Claude Code print-mode client (Stage 5-B).
 *
 * **Legacy / tests only.** Production node turns use `@superone/claude`
 * (Agent SDK) via `claude-turn-runner` (Stage 5-E). Kept for unit tests and as
 * a reference NDJSON stream mapper until fully retired.
 *
 * Lifecycle for one turn:
 * - spawn host/managed `claude` binary with `-p` / stream-json
 * - emit Stage 5-A structured `onEvent` for text / tool / status
 * - fall back to `onDelta` text only when `onEvent` is not provided
 * - wait for terminal `type: "result"` (session_id + final text)
 * - SIGTERM → SIGKILL on abort / close
 *
 * Permissions (Stage 5-D): CLI emits `control_request` / `can_use_tool`;
 * we park on TurnRunner `onPermission` and write `control_response`.
 * No `--dangerously-skip-permissions`. MCP/skills parity still deferred.
 *
 * Host credentials: the process inherits `$HOME` / env so Claude Code OAuth
 * under the user home works for the local lab (same as SUPERONE_CODEX_BINARY).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  redactHarnessDiagnosticText,
  type SessionTurnEvent,
} from '@superone/shared/environment'
import { safePublicError } from '@superone/codex'
import type { PendingInteraction, PermissionDecision } from './session-runtime'

/** Spawned Claude process: stdin/stdout/stderr piped for control protocol. */
export type ClaudeChildProcess = {
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill: (signal?: NodeJS.Signals | number) => boolean
  on: ChildProcessWithoutNullStreams['on']
  once: ChildProcessWithoutNullStreams['once']
  removeListener: ChildProcessWithoutNullStreams['removeListener']
}

export type ClaudeSpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: boolean
  },
) => ClaudeChildProcess

export interface RunClaudePrintTurnOptions {
  binaryPath: string
  prompt: string
  cwd: string
  /** Prior Claude Code session id for --resume. */
  sessionId?: string | null
  model?: string
  env?: NodeJS.ProcessEnv
  spawnFn?: ClaudeSpawnFn
  /**
   * Legacy text path. Used only when `onEvent` is absent so Claude does not
   * double-emit text (Codex keeps onDelta-only).
   */
  onDelta: (text: string) => void
  /**
   * Stage 5-A structured stream. Prefer this for Claude: text, tool, status.
   * Do not also send the same text via onDelta when this is set.
   */
  onEvent?: (event: SessionTurnEvent) => void
  /**
   * Stage 5-D blocking permission. Required for tools that need host approval.
   * When absent, can_use_tool requests are denied fail-closed.
   */
  onPermission?: (interaction: PendingInteraction) => Promise<PermissionDecision>
  signal: AbortSignal
  /** Kill escalation timeout after SIGTERM (ms). Default 2000. */
  killTimeoutMs?: number
  /** Max wall time for one turn (ms). Default 300_000. */
  turnTimeoutMs?: number
  /** Stable default assistant text block id (tests inject). */
  defaultTextBlockId?: string
}

export interface ClaudePrintTurnResult {
  finalText: string
  sessionId: string | null
}

const DEFAULT_TURN_TIMEOUT_MS = 300_000
const MAX_STDERR_CHARS = 8_000
const DEFAULT_TEXT_BLOCK_ID = 'assistant-text'

/**
 * Build argv for Claude Code print + stream-json (injectable for tests).
 */
export function buildClaudePrintArgs(opts: {
  prompt: string
  sessionId?: string | null
  model?: string
}): string[] {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    // Bidirectional stream-json enables control_request / can_use_tool.
    '--input-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
  ]
  if (opts.sessionId) {
    args.push('--resume', opts.sessionId)
  }
  if (opts.model) {
    args.push('--model', opts.model)
  }
  return args
}

/**
 * Build a control_response for a can_use_tool request (public for tests).
 */
export function buildClaudeControlResponse(opts: {
  requestId: string
  decision: PermissionDecision
  message?: string
}): Record<string, unknown> {
  if (opts.decision === 'allow') {
    return {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: opts.requestId,
        response: { behavior: 'allow' },
      },
    }
  }
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: opts.requestId,
      response: {
        behavior: 'deny',
        message: opts.message || 'Permission denied by SuperOne node',
      },
    },
  }
}

/**
 * Extract text delta from a stream-json NDJSON record, if any.
 * Public for unit tests.
 */
export function extractClaudeStreamDelta(record: Record<string, unknown>): string | null {
  if (record.type !== 'stream_event') return null
  const event = asRecord(record.event)
  if (!event || event.type !== 'content_block_delta') return null
  const delta = asRecord(event.delta)
  if (!delta) return null
  if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
    return delta.text
  }
  return null
}

/**
 * Extract assistant message text blocks (full message, not partial).
 * Used as fallback when partial messages are unavailable.
 */
export function extractClaudeAssistantText(record: Record<string, unknown>): string | null {
  if (record.type !== 'assistant') return null
  const message = asRecord(record.message)
  if (!message) return null
  const content = Array.isArray(message.content) ? message.content : []
  let text = ''
  for (const block of content) {
    const b = asRecord(block)
    if (b && b.type === 'text' && typeof b.text === 'string') {
      text += b.text
    }
  }
  return text.length > 0 ? text : null
}

interface OpenTool {
  toolUseId: string
  toolName: string
  input: string
  parentToolUseId: string | null
  completed: boolean
}

/**
 * Apply one Claude stream-json NDJSON record into structured turn events.
 * Pure enough for unit tests (stateful open-tool map is passed in).
 */
export function applyClaudeNdjsonRecord(
  record: Record<string, unknown>,
  state: {
    openTools: Map<string, OpenTool>
    textBlockId: string
    /** index → toolUseId for the active content block */
    indexToToolId: Map<number, string>
    /** index → 'text' | 'tool_use' */
    indexToKind: Map<number, 'text' | 'tool_use'>
  },
  emit: (event: SessionTurnEvent) => void,
): { textDelta: string | null; sessionId: string | null; isResult: boolean; resultIsError: boolean; resultText: string | null; resultError: string | null } {
  let sessionId: string | null =
    typeof record.session_id === 'string' && record.session_id.length > 0
      ? record.session_id
      : null
  const parentToolUseId =
    typeof record.parent_tool_use_id === 'string' ? record.parent_tool_use_id : null

  if (record.type === 'stream_event') {
    const event = asRecord(record.event)
    if (!event) {
      return emptyApply(sessionId)
    }
    const index = typeof event.index === 'number' ? event.index : null

    if (event.type === 'content_block_start') {
      const block = asRecord(event.content_block)
      if (!block) return emptyApply(sessionId)
      if (block.type === 'text' && index != null) {
        state.indexToKind.set(index, 'text')
      } else if (block.type === 'tool_use') {
        const toolUseId =
          typeof block.id === 'string' && block.id.length > 0 ? block.id : `tool-${index ?? 'x'}`
        const toolName =
          typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown'
        if (index != null) {
          state.indexToKind.set(index, 'tool_use')
          state.indexToToolId.set(index, toolUseId)
        }
        if (!state.openTools.has(toolUseId)) {
          const open: OpenTool = {
            toolUseId,
            toolName,
            input: '',
            parentToolUseId,
            completed: false,
          }
          state.openTools.set(toolUseId, open)
          emit({
            kind: 'tool',
            phase: 'started',
            toolUseId,
            toolName,
            parentToolUseId,
          })
        }
      }
      return emptyApply(sessionId)
    }

    if (event.type === 'content_block_delta') {
      const delta = asRecord(event.delta)
      if (!delta) return emptyApply(sessionId)
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
        return {
          textDelta: delta.text,
          sessionId,
          isResult: false,
          resultIsError: false,
          resultText: null,
          resultError: null,
        }
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const toolUseId =
          index != null ? state.indexToToolId.get(index) : undefined
        if (toolUseId) {
          const open = state.openTools.get(toolUseId)
          if (open) {
            open.input += delta.partial_json
            emit({
              kind: 'tool',
              phase: 'input_delta',
              toolUseId,
              toolName: open.toolName,
              input: delta.partial_json,
              parentToolUseId: open.parentToolUseId,
            })
          }
        }
      }
      return emptyApply(sessionId)
    }

    if (event.type === 'content_block_stop' && index != null) {
      // Tool completion comes from tool_result user messages; stop alone is not terminal.
      return emptyApply(sessionId)
    }

    return emptyApply(sessionId)
  }

  // Full assistant message: tools + optional text fallback.
  if (record.type === 'assistant') {
    const message = asRecord(record.message)
    const content = message && Array.isArray(message.content) ? message.content : []
    for (const raw of content) {
      const block = asRecord(raw)
      if (!block) continue
      if (block.type === 'tool_use') {
        const toolUseId =
          typeof block.id === 'string' && block.id.length > 0 ? block.id : null
        const toolName =
          typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown'
        if (!toolUseId) continue
        if (!state.openTools.has(toolUseId)) {
          let inputStr = ''
          if (typeof block.input === 'string') inputStr = block.input
          else if (block.input != null) {
            try {
              inputStr = JSON.stringify(block.input)
            } catch {
              inputStr = ''
            }
          }
          state.openTools.set(toolUseId, {
            toolUseId,
            toolName,
            input: inputStr,
            parentToolUseId,
            completed: false,
          })
          emit({
            kind: 'tool',
            phase: 'started',
            toolUseId,
            toolName,
            input: inputStr || undefined,
            parentToolUseId,
          })
        }
      }
    }
    return emptyApply(sessionId)
  }

  // User tool results complete tools.
  if (record.type === 'user') {
    const message = asRecord(record.message)
    const content = message && Array.isArray(message.content) ? message.content : []
    for (const raw of content) {
      const block = asRecord(raw)
      if (!block || block.type !== 'tool_result') continue
      const toolUseId =
        typeof block.tool_use_id === 'string'
          ? block.tool_use_id
          : typeof block.toolUseId === 'string'
            ? block.toolUseId
            : null
      if (!toolUseId) continue
      const open = state.openTools.get(toolUseId)
      const toolName = open?.toolName ?? 'unknown'
      const isError = block.is_error === true
      let output: string | undefined
      if (typeof block.content === 'string') output = block.content
      else if (block.content != null) {
        try {
          output = JSON.stringify(block.content)
        } catch {
          output = String(block.content)
        }
      }
      if (open) open.completed = true
      emit({
        kind: 'tool',
        phase: isError ? 'failed' : 'completed',
        toolUseId,
        toolName,
        output,
        ...(isError ? { isError: true } : {}),
        parentToolUseId: open?.parentToolUseId ?? parentToolUseId,
      })
    }
    return emptyApply(sessionId)
  }

  if (record.type === 'result') {
    const resultIsError = record.is_error === true || record.subtype === 'error'
    const resultText = typeof record.result === 'string' ? record.result : null
    let resultError: string | null = null
    if (resultIsError) {
      resultError =
        resultText ||
        (typeof record.errors === 'string' ? record.errors : null) ||
        'Claude turn failed'
    }
    // Close any tools left open without a tool_result (print mode often omits them).
    for (const open of state.openTools.values()) {
      if (open.completed) continue
      open.completed = true
      emit({
        kind: 'tool',
        phase: 'completed',
        toolUseId: open.toolUseId,
        toolName: open.toolName,
        input: open.input || undefined,
        parentToolUseId: open.parentToolUseId,
      })
    }
    return {
      textDelta: null,
      sessionId,
      isResult: true,
      resultIsError,
      resultText,
      resultError,
    }
  }

  return emptyApply(sessionId)
}

function emptyApply(sessionId: string | null) {
  return {
    textDelta: null as string | null,
    sessionId,
    isResult: false,
    resultIsError: false,
    resultText: null as string | null,
    resultError: null as string | null,
  }
}

export async function runClaudePrintTurn(
  opts: RunClaudePrintTurnOptions,
): Promise<ClaudePrintTurnResult> {
  if (opts.signal.aborted) {
    throw new Error('Claude turn interrupted')
  }
  if (!opts.binaryPath || !existsSync(opts.binaryPath)) {
    throw new Error(`Claude binary not found: ${opts.binaryPath || '(empty)'}`)
  }

  const useOnEvent = typeof opts.onEvent === 'function'
  const emitEvent = (event: SessionTurnEvent) => {
    opts.onEvent?.(event)
  }

  const emitTextDelta = (blockId: string, delta: string) => {
    if (useOnEvent) {
      emitEvent({ kind: 'text', blockId, delta })
    } else {
      opts.onDelta(delta)
    }
  }

  const emitTextFinal = (blockId: string, text: string) => {
    if (useOnEvent) {
      emitEvent({ kind: 'text', blockId, final: true, text })
    } else if (text && !streamedAny) {
      opts.onDelta(text)
    }
  }

  const spawnFn = opts.spawnFn ?? defaultSpawn
  const args = buildClaudePrintArgs({
    prompt: opts.prompt,
    sessionId: opts.sessionId,
    model: opts.model,
  })
  const env = { ...process.env, ...(opts.env ?? {}) }
  const child = spawnFn(opts.binaryPath, args, {
    cwd: opts.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  if (!child.stdout) {
    child.kill()
    throw new Error('Failed to start Claude print process (missing stdout)')
  }
  if (!child.stdin) {
    child.kill()
    throw new Error('Failed to start Claude print process (missing stdin for control)')
  }

  const writeControlLine = (payload: Record<string, unknown>) => {
    try {
      child.stdin!.write(`${JSON.stringify(payload)}\n`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
        throw new Error('Claude control write failed (broken pipe)')
      }
      throw err
    }
  }

  /**
   * Handle CLI → host control_request. Only can_use_tool is interactive;
   * other subtypes get a fail-closed error response so the CLI does not hang.
   */
  const handleControlRequest = async (rec: Record<string, unknown>): Promise<void> => {
    const requestId = typeof rec.request_id === 'string' ? rec.request_id : null
    const request = asRecord(rec.request)
    if (!requestId || !request) {
      return
    }
    if (request.subtype === 'can_use_tool') {
      const toolName =
        typeof request.tool_name === 'string' && request.tool_name.length > 0
          ? request.tool_name
          : 'unknown'
      const toolUseId =
        typeof request.tool_use_id === 'string' && request.tool_use_id.length > 0
          ? request.tool_use_id
          : undefined
      const input =
        request.input && typeof request.input === 'object' && !Array.isArray(request.input)
          ? (request.input as Record<string, unknown>)
          : undefined

      let decision: PermissionDecision = 'deny'
      if (opts.onPermission) {
        decision = await opts.onPermission({
          interactionId: randomUUID(),
          kind: 'permission',
          toolName,
          toolUseId,
          input,
          createdAt: Date.now(),
        })
      }
      if (opts.signal.aborted) {
        decision = 'deny'
      }
      writeControlLine(
        buildClaudeControlResponse({
          requestId,
          decision,
          message: decision === 'deny' ? 'Permission denied' : undefined,
        }),
      )
      return
    }

    // Fail-closed for unhandled control subtypes (initialize is typically client→CLI).
    writeControlLine({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: `unsupported control subtype: ${String(request.subtype ?? 'unknown')}`,
      },
    })
  }

  let stderrBuf = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrBuf = (stderrBuf + chunk).slice(-MAX_STDERR_CHARS)
  })

  let processExited = false
  let exitCode: number | null = null
  let readError: Error | null = null

  const terminateChild = async (): Promise<void> => {
    if (processExited) return
    const killTimeoutMs = opts.killTimeoutMs ?? 2_000
    await new Promise<void>((resolve) => {
      if (processExited) {
        resolve()
        return
      }
      const onExit = () => {
        clearTimeout(t)
        resolve()
      }
      child.once('exit', onExit)
      try {
        child.kill('SIGTERM')
      } catch {
        child.removeListener('exit', onExit)
        resolve()
        return
      }
      const t = setTimeout(() => {
        if (!processExited) {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }
        setTimeout(() => {
          child.removeListener('exit', onExit)
          resolve()
        }, 500)
      }, killTimeoutMs)
    })
  }

  const onAbort = () => {
    void terminateChild()
  }
  opts.signal.addEventListener('abort', onAbort)

  child.on('error', (err) => {
    readError = safePublicError('Claude process spawn failed', err)
  })
  child.on('exit', (code) => {
    processExited = true
    exitCode = typeof code === 'number' ? code : null
  })

  const rl = createInterface({ input: child.stdout })
  let sessionId: string | null = opts.sessionId ?? null
  let finalText = ''
  let streamedAny = false
  let sawResult = false
  let resultIsError = false
  let resultErrorMessage: string | null = null
  const textBlockId = opts.defaultTextBlockId ?? DEFAULT_TEXT_BLOCK_ID
  const state = {
    openTools: new Map<string, OpenTool>(),
    textBlockId,
    indexToToolId: new Map<number, string>(),
    indexToKind: new Map<number, 'text' | 'tool_use'>(),
  }

  const turnTimeoutMs = opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
  const deadline = Date.now() + turnTimeoutMs

  emitEvent({ kind: 'status', status: 'streaming' })

  try {
    for await (const line of rl) {
      if (opts.signal.aborted) {
        throw new Error('Claude turn interrupted')
      }
      if (Date.now() > deadline) {
        throw new Error('Claude turn timed out')
      }
      if (readError) throw readError

      const trimmed = `${line}`.trim()
      if (!trimmed) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object') continue
      const rec = parsed as Record<string, unknown>

      // Stage 5-D: CLI permission / control protocol over stream-json.
      if (rec.type === 'control_request') {
        await handleControlRequest(rec)
        continue
      }
      if (rec.type === 'control_cancel_request') {
        // Host has no multi-request cancel bookkeeping beyond signal abort.
        continue
      }

      const applied = applyClaudeNdjsonRecord(rec, state, emitEvent)
      if (applied.sessionId) sessionId = applied.sessionId

      if (applied.textDelta) {
        streamedAny = true
        finalText += applied.textDelta
        emitTextDelta(textBlockId, applied.textDelta)
      }

      // Fallback: full assistant text when partial stream is absent.
      if (!streamedAny && rec.type === 'assistant') {
        const assistantText = extractClaudeAssistantText(rec)
        if (assistantText) {
          const prev = finalText
          finalText = assistantText
          if (assistantText.startsWith(prev)) {
            const extra = assistantText.slice(prev.length)
            if (extra) {
              streamedAny = true
              emitTextDelta(textBlockId, extra)
            }
          } else if (assistantText !== prev) {
            streamedAny = true
            emitTextDelta(textBlockId, assistantText)
          }
        }
      }

      if (applied.isResult) {
        sawResult = true
        resultIsError = applied.resultIsError
        resultErrorMessage = applied.resultError
        if (applied.resultText != null) {
          if (!streamedAny || !finalText) {
            finalText = applied.resultText
          }
          if (!streamedAny && applied.resultText) {
            emitTextDelta(textBlockId, applied.resultText)
            streamedAny = true
          }
        }
        break
      }
    }
  } catch (err) {
    await terminateChild()
    opts.signal.removeEventListener('abort', onAbort)
    if (opts.signal.aborted) {
      emitEvent({ kind: 'status', status: 'interrupted' })
      throw new Error('Claude turn interrupted')
    }
    emitEvent({ kind: 'status', status: 'error', message: 'turn_failed' })
    throw err instanceof Error ? err : safePublicError('Claude turn failed', err)
  } finally {
    opts.signal.removeEventListener('abort', onAbort)
    rl.close()
    if (!processExited) {
      await terminateChild()
    }
  }

  if (opts.signal.aborted) {
    emitEvent({ kind: 'status', status: 'interrupted' })
    throw new Error('Claude turn interrupted')
  }
  if (readError) {
    emitEvent({ kind: 'status', status: 'error', message: 'spawn_or_read_failed' })
    throw readError
  }

  if (resultIsError) {
    emitEvent({ kind: 'status', status: 'error', message: 'result_error' })
    throw safePublicError(resultErrorMessage || 'Claude turn failed')
  }

  if (!sawResult) {
    if (exitCode != null && exitCode !== 0) {
      emitEvent({ kind: 'status', status: 'error', message: `exit_${exitCode}` })
      throw safePublicError(
        `Claude process exited with code ${exitCode}`,
        stderrBuf ? new Error(redactHarnessDiagnosticText(stderrBuf).slice(-200)) : undefined,
      )
    }
    if (!finalText) {
      emitEvent({ kind: 'status', status: 'error', message: 'missing_result' })
      throw safePublicError('Claude turn ended without a result record')
    }
  }

  emitTextFinal(textBlockId, finalText)
  emitEvent({ kind: 'status', status: 'idle' })

  return { finalText, sessionId }
}

function defaultSpawn(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: boolean
  },
): ClaudeChildProcess {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  }) as unknown as ClaudeChildProcess
}


function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
