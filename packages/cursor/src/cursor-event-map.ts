import type {
  ConversationStep,
  InteractionUpdate,
  SDKMessage,
  SDKToolUseMessage,
} from '@cursor/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

/** Map Cursor toolCall.type (and free-form names) to SuperOne tool display names. */
export function toolDisplayName(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('shell') || n === 'bash') return 'Bash'
  if (n.includes('read') && !n.includes('lint')) return 'Read'
  if (n.includes('write')) return 'Write'
  if (n.includes('edit') || n.includes('replace')) return 'Edit'
  if (n === 'delete') return 'Delete'
  if (n.includes('grep')) return 'Grep'
  if (n === 'ls') return 'LS'
  if (n.includes('glob')) return 'Glob'
  if (n.includes('todo')) return 'TodoWrite'
  if (n === 'agent' || n.includes('task')) return 'Agent'
  if (n === 'mcp') return 'MCP'
  if (n === 'websearch') return 'WebSearch'
  if (n.includes('search')) return 'SemanticSearch'
  if (n.includes('lint')) return 'ReadLints'
  if (n.includes('image')) return 'GenerateImage'
  if (n.includes('plan')) return 'CreatePlan'
  if (n === 'recordscreen') return 'RecordScreen'
  return name
}

function strField(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') return ''
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

/** Real call id only — never invents `tool_<timestamp>` placeholders. */
export function stableIdField(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  for (const key of keys) {
    if (typeof rec[key] === 'string' && rec[key]) return rec[key] as string
  }
  return null
}

function idField(obj: unknown, ...keys: string[]): string {
  return stableIdField(obj, ...keys) ?? `tool_${Date.now()}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringifyPayload(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Extract tool identity + args from either the real SDK shape
 * (`toolCall: { type, args, result? }`) or a flat legacy shape (`name`/`args`).
 */
export function extractToolCallParts(update: unknown): {
  callId: string
  toolType: string
  args: unknown
  result: unknown
  isError: boolean
} {
  const rec = asRecord(update) ?? {}
  const callId = idField(rec, 'callId', 'toolCallId', 'id', 'call_id')
  const nested = asRecord(rec.toolCall)
  if (nested) {
    const toolType = typeof nested.type === 'string' && nested.type ? nested.type : 'Tool'
    const result = nested.result
    const resultRec = asRecord(result)
    const isError = resultRec?.status === 'error'
      || Boolean(rec.isError)
    return {
      callId,
      toolType,
      args: nested.args ?? nested.input ?? {},
      result: resultRec?.status === 'success'
        ? (resultRec.value ?? result)
        : resultRec?.status === 'error'
          ? (resultRec.error ?? result)
          : result,
      isError,
    }
  }
  const toolType = strField(rec, 'name') || strField(rec, 'type') || 'Tool'
  return {
    callId,
    toolType,
    args: rec.args ?? rec.input ?? {},
    result: rec.result,
    isError: Boolean(rec.isError),
  }
}

function mapTodosPayload(todos: unknown): AgentEvent | null {
  if (!Array.isArray(todos)) return null
  return {
    type: 'todos_updated',
    todos: todos.map((todo, index) => {
      const row = asRecord(todo) ?? {}
      const statusRaw = String(row.status ?? 'pending')
      return {
        id: String(row.id ?? index + 1),
        subject: String(row.content ?? row.subject ?? row.text ?? ''),
        description: String(row.description ?? ''),
        status: statusRaw === 'in_progress' || statusRaw === 'in-progress'
          ? 'in_progress' as const
          : statusRaw === 'completed' || statusRaw === 'cancelled'
            ? 'completed' as const
            : 'pending' as const,
      }
    }),
  }
}

function toolUseEvent(
  messageId: string,
  callId: string,
  toolType: string,
  args: unknown,
  status: 'streaming' | 'complete',
): AgentEvent {
  return {
    type: 'content_delta',
    messageId,
    delta: {
      type: 'tool_use',
      toolName: toolDisplayName(toolType),
      toolUseId: callId,
      input: stringifyPayload(args ?? {}),
      status,
      ...(status === 'streaming' ? { startedAt: Date.now() } : {}),
    },
  }
}

function toolResultEvent(
  messageId: string,
  callId: string,
  result: unknown,
  isError: boolean,
): AgentEvent {
  return {
    type: 'content_delta',
    messageId,
    delta: {
      type: 'tool_result',
      toolUseId: callId,
      summary: stringifyPayload(result),
      isError,
    },
  }
}

function usageFromTurn(
  messageId: string,
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens?: number
  },
  extras?: { contextWindow?: number | null },
): AgentEvent {
  return {
    type: 'message_usage',
    messageId,
    inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    outputTokens: usage.outputTokens + (usage.reasoningTokens ?? 0),
    cacheReadTokens: usage.cacheReadTokens,
    ...(extras?.contextWindow && extras.contextWindow > 0
      ? { contextWindow: extras.contextWindow, contextTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens }
      : {}),
  }
}

export interface MapInteractionOptions {
  /** Optional context window for turn-ended / token usage events. */
  contextWindow?: number | null
}

/** Live content path (D6): InteractionUpdate → AgentEvent */
export function mapInteractionUpdate(
  messageId: string,
  update: InteractionUpdate,
  options?: MapInteractionOptions,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const type = String((update as { type?: string }).type ?? '')
  const rec = asRecord(update) ?? {}

  switch (type) {
    case 'text-delta': {
      const text = strField(update, 'text')
      if (text) {
        events.push({ type: 'content_delta', messageId, delta: { type: 'text', text } })
      }
      break
    }
    case 'thinking-delta': {
      const text = strField(update, 'text')
      if (text) {
        events.push({
          type: 'content_delta',
          messageId,
          delta: { type: 'thinking', thinking: text },
        })
      }
      break
    }
    case 'thinking-completed': {
      const duration = Number((update as { thinkingDurationMs?: number }).thinkingDurationMs)
      events.push({
        type: 'content_delta',
        messageId,
        delta: {
          type: 'thinking',
          thinking: '',
          endedAt: Date.now(),
          ...(Number.isFinite(duration) ? { startedAt: Date.now() - duration } : {}),
        },
      })
      break
    }
    case 'tool-call-started':
    case 'partial-tool-call': {
      const parts = extractToolCallParts(update)
      events.push(toolUseEvent(messageId, parts.callId, parts.toolType, parts.args, 'streaming'))
      if (parts.toolType === 'updateTodos' || parts.toolType === 'update_todos') {
        const todos = asRecord(parts.args)?.todos
        const todoEvent = mapTodosPayload(todos)
        if (todoEvent) events.push(todoEvent)
      }
      if (parts.toolType === 'task') {
        const description = strField(parts.args, 'description')
          || strField(parts.args, 'prompt')
          || strField(parts.args, 'text')
          || 'Task'
        events.push({
          type: 'task_started',
          taskId: parts.callId,
          description,
        })
      }
      break
    }
    case 'tool-call-delta': {
      // Nested progress for a running tool (sub-agent text, nested tool calls).
      // Do not fan shell-output chunks into tool_result (append-only → duplicates).
      const taskUpdate = rec.taskUpdate
      if (taskUpdate && typeof taskUpdate === 'object') {
        const nestedType = strField(taskUpdate, 'type')
        if (nestedType === 'shell-output-delta') {
          break
        }
        if (nestedType === 'text-delta') {
          // Nested assistant text inside a task tool — surface as thinking-less text.
          const text = strField(taskUpdate, 'text')
          if (text) {
            events.push({
              type: 'content_delta',
              messageId,
              delta: { type: 'text', text },
            })
          }
          break
        }
        events.push(...mapInteractionUpdate(messageId, taskUpdate as InteractionUpdate, options))
      }
      break
    }
    case 'tool-call-completed': {
      const parts = extractToolCallParts(update)
      events.push(toolUseEvent(messageId, parts.callId, parts.toolType, parts.args, 'complete'))
      events.push(toolResultEvent(messageId, parts.callId, parts.result, parts.isError))
      if (parts.toolType === 'updateTodos' || parts.toolType === 'update_todos') {
        const todos = asRecord(parts.args)?.todos ?? asRecord(parts.result)?.todos
        const todoEvent = mapTodosPayload(todos)
        if (todoEvent) events.push(todoEvent)
      }
      if (parts.toolType === 'task') {
        events.push({
          type: 'task_notification',
          taskId: parts.callId,
          taskStatus: parts.isError ? 'failed' : 'completed',
          outputFile: '',
          summary: stringifyPayload(parts.result) || strField(parts.args, 'description') || 'Task',
        })
      }
      break
    }
    case 'token-delta': {
      const tokens = Number((update as { tokens?: number }).tokens)
      if (Number.isFinite(tokens) && tokens > 0) {
        events.push({
          type: 'message_usage',
          messageId,
          inputTokens: tokens,
          outputTokens: 0,
          contextTokens: tokens,
          ...(options?.contextWindow && options.contextWindow > 0
            ? { contextWindow: options.contextWindow }
            : {}),
        })
      }
      break
    }
    case 'turn-ended': {
      const usage = (update as {
        usage?: {
          inputTokens: number
          outputTokens: number
          cacheReadTokens: number
          cacheWriteTokens: number
          reasoningTokens?: number
        }
      }).usage
      if (usage) {
        events.push(usageFromTurn(messageId, usage, { contextWindow: options?.contextWindow }))
      }
      events.push({ type: 'status_change', status: 'idle' })
      break
    }
    case 'shell-output-delta': {
      // SDK 1.0.24 shape is only `{ type, event: Record }` — callId is not a
      // first-class field (may or may not appear inside `event`). Emitting
      // per-chunk tool_result duplicates (append-only), and dumping chunks as
      // assistant text floods the transcript. Prefer the final
      // tool-call-completed payload for Bash results; ignore live chunks here.
      break
    }
    case 'user-message-appended': {
      // Composer already owns the user bubble — ignore echo to avoid duplicates.
      break
    }
    case 'summary':
    case 'summary-started':
    case 'summary-completed': {
      // SDK: text lives on `summary`; `summary-completed` is often an empty marker.
      // Emit when we have payload text; ignore empty started/completed markers.
      const text = strField(update, 'text') || strField(update, 'summary')
      if (text) {
        events.push({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: `\n${text}\n` },
        })
      }
      break
    }
    case 'step-started':
    case 'step-completed': {
      // Telemetry-only in host for now.
      break
    }
    default: {
      // Nested-task style aliases + free-form todos payloads.
      if (type === 'nested-task' || type === 'task-started' || type === 'task-completed') {
        const taskId = idField(update, 'taskId', 'id', 'callId')
        const description = strField(update, 'description') || strField(update, 'text') || 'Task'
        if (type === 'task-started' || type === 'nested-task') {
          events.push({ type: 'task_started', taskId, description })
        } else {
          events.push({
            type: 'task_notification',
            taskId,
            taskStatus: 'completed',
            outputFile: '',
            summary: description,
          })
        }
        break
      }
      const todos = (update as { todos?: unknown }).todos
      const todoEvent = mapTodosPayload(todos)
      if (todoEvent) events.push(todoEvent)
      break
    }
  }
  return events
}

export interface MapConversationStepOptions {
  /**
   * Resolve a real SDK callId when ConversationStep.toolCall has none (SDK 1.0.24
   * shape is `{ type: 'toolCall', message }` only). Typically a FIFO of callIds
   * observed on tool-call-started/partial/completed deltas for this turn.
   */
  resolveCallId?: (step: ConversationStep) => string | null
}

/**
 * Finalize a completed ConversationStep (onStep path).
 *
 * Content already streams via onDelta. onStep only patches tool_use input/status
 * so partial args converge. Never emit tool_result here — SuperOne appends every
 * tool_result block, so pairing with onDelta's tool-call-completed would duplicate.
 *
 * Never invents tool ids: without a stable callId the step is skipped so we do
 * not create an orphan tool_use row that cannot merge with the live delta path.
 */
export function mapConversationStep(
  messageId: string,
  step: ConversationStep,
  options?: MapConversationStepOptions,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const rec = asRecord(step)
  if (!rec) return events
  const stepType = strField(rec, 'type')

  if (stepType === 'assistantMessage' || stepType === 'thinkingMessage') {
    // Live text/thinking already streamed via onDelta.
    return events
  }

  if (stepType === 'toolCall') {
    const message = rec.message ?? rec.toolCall ?? rec
    const nested = asRecord(message)
    const explicitCallId = stableIdField(rec, 'callId', 'toolCallId', 'id', 'call_id')
      || stableIdField(nested, 'callId', 'toolCallId', 'id', 'call_id')
    const callId = explicitCallId || options?.resolveCallId?.(step) || null
    if (!callId) {
      // No stable id — onDelta already owns the real tool_use row.
      return events
    }
    const toolType = nested && typeof nested.type === 'string' && nested.type
      ? nested.type
      : (strField(rec, 'name') || 'Tool')
    const args = nested?.args ?? nested?.input ?? {}
    events.push(toolUseEvent(messageId, callId, toolType, args, 'complete'))
    if (toolType === 'updateTodos' || toolType === 'update_todos') {
      const todos = asRecord(args)?.todos
      const todoEvent = mapTodosPayload(todos)
      if (todoEvent) events.push(todoEvent)
    }
  }

  return events
}

/**
 * Per-turn helper: record real callIds from onDelta so onStep can patch the same
 * tool_use rows (ConversationStep.toolCall has no callId in SDK 1.0.24).
 */
export class CursorTurnCallIdBridge {
  private readonly queue: string[] = []
  private readonly seen = new Set<string>()

  /** Observe a live InteractionUpdate; record callIds from tool-call events. */
  observeDelta(update: InteractionUpdate): void {
    const type = String((update as { type?: string }).type ?? '')
    if (
      type !== 'tool-call-started'
      && type !== 'partial-tool-call'
      && type !== 'tool-call-completed'
    ) {
      return
    }
    const callId = stableIdField(update, 'callId', 'toolCallId', 'id', 'call_id')
    if (!callId || this.seen.has(callId)) return
    this.seen.add(callId)
    this.queue.push(callId)
  }

  /** FIFO claim for the next onStep toolCall (or null if nothing to associate). */
  claimNextCallId(): string | null {
    return this.queue.shift() ?? null
  }
}

/** Reattach / lifecycle path (D6). */
export function mapSdkMessageLifecycle(
  messageId: string,
  message: SDKMessage,
  options?: { includeContent?: boolean; contextWindow?: number | null },
): AgentEvent[] {
  const events: AgentEvent[] = []
  const includeContent = options?.includeContent === true

  switch (message.type) {
    case 'status': {
      if (message.status === 'RUNNING' || message.status === 'CREATING') {
        events.push({ type: 'status_change', status: 'streaming' })
      } else if (message.status === 'FINISHED' || message.status === 'CANCELLED' || message.status === 'EXPIRED') {
        events.push({ type: 'status_change', status: 'idle' })
      } else if (message.status === 'ERROR') {
        events.push({ type: 'message_error', messageId, error: message.message ?? 'Cursor run error' })
        events.push({ type: 'status_change', status: 'error' })
      }
      break
    }
    case 'system': {
      if (message.subtype === 'init') {
        events.push({ type: 'provider_session_id', providerSessionId: message.agent_id })
      }
      break
    }
    case 'usage': {
      const u = message.usage
      events.push(usageFromTurn(messageId, {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
        reasoningTokens: u.reasoningTokens,
      }, { contextWindow: options?.contextWindow }))
      break
    }
    case 'thinking': {
      if (includeContent && message.text) {
        events.push({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'thinking',
            thinking: message.text,
            ...(message.thinking_duration_ms != null
              ? { endedAt: Date.now(), startedAt: Date.now() - message.thinking_duration_ms }
              : {}),
          },
        })
      }
      break
    }
    case 'assistant': {
      if (includeContent) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            events.push({
              type: 'content_delta',
              messageId,
              delta: { type: 'text', text: block.text },
            })
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'content_delta',
              messageId,
              delta: {
                type: 'tool_use',
                toolName: toolDisplayName(block.name),
                toolUseId: block.id,
                input: JSON.stringify(block.input ?? {}),
                status: 'streaming',
              },
            })
          }
        }
      }
      break
    }
    case 'tool_call': {
      if (includeContent) events.push(...mapToolCallMessage(messageId, message))
      break
    }
    case 'task': {
      const taskId = message.agent_id || `task_${Date.now()}`
      const text = message.text ?? ''
      if (message.status === 'running' || message.status === 'pending') {
        events.push({ type: 'task_started', taskId, description: text || 'Task' })
      } else if (message.status === 'completed' || message.status === 'failed') {
        events.push({
          type: 'task_notification',
          taskId,
          taskStatus: message.status === 'failed' ? 'failed' : 'completed',
          outputFile: '',
          summary: text || 'Task',
        })
      }
      break
    }
    default:
      break
  }
  return events
}

function mapToolCallMessage(messageId: string, message: SDKToolUseMessage): AgentEvent[] {
  const events: AgentEvent[] = [{
    type: 'content_delta',
    messageId,
    delta: {
      type: 'tool_use',
      toolName: toolDisplayName(message.name),
      toolUseId: message.call_id,
      input: JSON.stringify(message.args ?? {}),
      status: message.status === 'completed' || message.status === 'error' ? 'complete' : 'streaming',
    },
  }]
  if (message.status === 'completed' || message.status === 'error') {
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId: message.call_id,
        summary: message.result === undefined
          ? ''
          : typeof message.result === 'string' ? message.result : JSON.stringify(message.result),
        isError: message.status === 'error',
      },
    })
  }
  return events
}
