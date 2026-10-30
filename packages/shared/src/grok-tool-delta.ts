import type { AgentEvent } from './agent-types'
import {
  grokCollabStreamingInput,
  isAlwaysHiddenToolName,
  isSessionCollabToolName,
  resolveGrokStreamingToolName,
} from './tool-ui'

/**
 * Correlation the streaming Grok tool-call mapper mutates. Desktop and the
 * ACP package each keep a larger session state; this is the part both share.
 */
export interface GrokToolDeltaState {
  lastMessageId: string | null
  deltaToolStarted: Set<string>
  deltaToolWireName: Map<string, string>
  deltaToolArgs: Map<string, string>
  deltaCollabInput: Map<string, string>
  deltaToolIdByIndex: Map<number, string>
}

function strField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function numField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * One `tool_call_delta_chunk`. Collab tools emit the inner tool input as a
 * `content_delta`. Other tools emit `tool_input_delta` and never the envelope.
 */
export function mapGrokToolCallDeltaChunk(
  update: Record<string, unknown>,
  state: GrokToolDeltaState,
  ctx: { messageId?: string | null },
): AgentEvent[] {
  const toolCallId = strField(update, 'tool_call_id', 'toolCallId')
  const index = numField(update, 'tool_index', 'toolIndex')
  if (index != null && toolCallId) state.deltaToolIdByIndex.set(index, toolCallId)
  const id = toolCallId
    ?? (index != null ? state.deltaToolIdByIndex.get(index) : undefined)
    ?? (index != null ? `acp_delta_${index}` : null)
  const messageId = ctx.messageId ?? state.lastMessageId
  if (!id || !messageId) return []
  const name = strField(update, 'name')
  const delta = strField(update, 'arguments_delta', 'argumentsDelta') ?? ''
  if (name) state.deltaToolWireName.set(id, name)
  if (delta) state.deltaToolArgs.set(id, (state.deltaToolArgs.get(id) ?? '') + delta)
  const resolved = resolveGrokStreamingToolName(
    name ?? state.deltaToolWireName.get(id),
    state.deltaToolArgs.get(id),
  )
  const events: AgentEvent[] = []
  const hidden = resolved ? isAlwaysHiddenToolName(resolved) : false
  // Collab rows read launches/content/task on the tool block. tool_input_delta
  // is ignored for these tools live, and would store the use_tool envelope.
  if (resolved && isSessionCollabToolName(resolved)) {
    const input = grokCollabStreamingInput(state.deltaToolArgs.get(id)) ?? ''
    const previous = state.deltaCollabInput.get(id)
    if (!state.deltaToolStarted.has(id) || (input && input !== previous)) {
      if (!state.deltaToolStarted.has(id)) state.deltaToolStarted.add(id)
      if (input) state.deltaCollabInput.set(id, input)
      events.push({
        type: 'content_delta',
        messageId,
        delta: {
          type: 'tool_use',
          toolUseId: id,
          toolName: resolved,
          input,
          status: 'streaming',
        },
      })
    }
    return events
  }
  if (resolved && !hidden && !state.deltaToolStarted.has(id)) {
    state.deltaToolStarted.add(id)
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolUseId: id,
        toolName: resolved,
        input: '',
        status: 'streaming',
      },
    })
    const acc = state.deltaToolArgs.get(id)
    if (acc) {
      events.push({
        type: 'tool_input_delta',
        messageId,
        toolUseId: id,
        partialJson: acc,
      })
    }
    state.deltaToolArgs.delete(id)
  } else if (delta && state.deltaToolStarted.has(id)) {
    events.push({
      type: 'tool_input_delta',
      messageId,
      toolUseId: id,
      partialJson: delta,
    })
  }
  if (resolved && hidden && resolved !== 'UseTool') {
    state.deltaToolArgs.delete(id)
  }
  return events
}
