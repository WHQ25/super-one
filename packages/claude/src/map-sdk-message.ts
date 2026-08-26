/**
 * Legacy Claude Agent SDK message -> SessionTurnEvent adapter.
 *
 * New Claude hosts should use agent-event-mapper so rich desktop semantics are
 * not reduced to the Stage 5-A text/tool/status subset.
 */

import type { SessionTurnEvent } from '@superone/shared/environment'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { extractClaudeToolResultText } from './agent-event-mapper'

export interface OpenTool {
  toolUseId: string
  toolName: string
  input: string
  parentToolUseId: string | null
  completed: boolean
}

export interface SdkMapState {
  openTools: Map<string, OpenTool>
  textBlockId: string
  /** stream_event index → toolUseId */
  indexToToolId: Map<number, string>
  indexToKind: Map<number, 'text' | 'tool_use'>
}

export interface SdkMapApplyResult {
  textDelta: string | null
  sessionId: string | null
  isResult: boolean
  resultIsError: boolean
  resultText: string | null
  resultError: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function emptyApply(sessionId: string | null): SdkMapApplyResult {
  return {
    textDelta: null,
    sessionId,
    isResult: false,
    resultIsError: false,
    resultText: null,
    resultError: null,
  }
}

function sessionIdOf(msg: Record<string, unknown>): string | null {
  return typeof msg.session_id === 'string' && msg.session_id.length > 0
    ? msg.session_id
    : null
}

function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (input == null) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

function stringifyOutput(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (content == null) return undefined
  // Since SDK 0.3.243 a Read on a PDF puts its `document` block — or one `image`
  // block per page — inside the tool_result content instead of a separate user
  // message trailing it. Serializing those verbatim pushes megabytes of base64
  // into the event stream, so keep only the text blocks, matching what the
  // lossless agent-event path already does.
  if (Array.isArray(content)) return extractClaudeToolResultText(content) || undefined
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/**
 * Apply one SDK message into structured turn events.
 * Accepts SDKMessage or plain records (tests).
 */
export function applySdkMessage(
  message: SDKMessage | Record<string, unknown>,
  state: SdkMapState,
  emit: (event: SessionTurnEvent) => void,
): SdkMapApplyResult {
  const record = message as unknown as Record<string, unknown>
  const sessionId = sessionIdOf(record)
  const parentToolUseId =
    typeof record.parent_tool_use_id === 'string' ? record.parent_tool_use_id : null

  if (record.type === 'stream_event') {
    const event = asRecord(record.event)
    if (!event) return emptyApply(sessionId)
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
        const toolUseId = index != null ? state.indexToToolId.get(index) : undefined
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

    return emptyApply(sessionId)
  }

  if (record.type === 'assistant') {
    const messageBody = asRecord(record.message)
    const content = messageBody && Array.isArray(messageBody.content) ? messageBody.content : []
    for (const raw of content) {
      const block = asRecord(raw)
      if (!block || block.type !== 'tool_use') continue
      const toolUseId = typeof block.id === 'string' && block.id.length > 0 ? block.id : null
      const toolName =
        typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown'
      if (!toolUseId) continue
      if (!state.openTools.has(toolUseId)) {
        const inputStr = stringifyInput(block.input)
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
    return emptyApply(sessionId)
  }

  if (record.type === 'user') {
    const messageBody = asRecord(record.message)
    const content = messageBody && Array.isArray(messageBody.content) ? messageBody.content : []
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
      const output = stringifyOutput(block.content)
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

export function createSdkMapState(textBlockId: string): SdkMapState {
  return {
    openTools: new Map(),
    textBlockId,
    indexToToolId: new Map(),
    indexToKind: new Map(),
  }
}
