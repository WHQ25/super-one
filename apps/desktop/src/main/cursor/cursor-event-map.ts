import type { InteractionUpdate, SDKMessage, SDKToolUseMessage } from '@cursor/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

function toolDisplayName(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('shell') || n === 'bash') return 'Bash'
  if (n.includes('read')) return 'Read'
  if (n.includes('write')) return 'Write'
  if (n.includes('edit') || n.includes('replace')) return 'Edit'
  if (n.includes('grep')) return 'Grep'
  if (n.includes('glob') || n.includes('ls')) return 'Glob'
  if (n.includes('todo')) return 'TodoWrite'
  if (n.includes('task') || n.includes('agent')) return 'Agent'
  return name
}

function strField(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') return ''
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

function idField(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return `tool_${Date.now()}`
  const rec = obj as Record<string, unknown>
  for (const key of keys) {
    if (typeof rec[key] === 'string' && rec[key]) return rec[key] as string
  }
  return `tool_${Date.now()}`
}

/** Live content path (D6): InteractionUpdate → AgentEvent */
export function mapInteractionUpdate(
  messageId: string,
  update: InteractionUpdate,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const type = String((update as { type?: string }).type ?? '')

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
    case 'tool-call-delta':
    case 'partial-tool-call': {
      const toolUseId = idField(update, 'callId', 'toolCallId', 'id')
      const name = toolDisplayName(strField(update, 'name') || 'Tool')
      const args = (update as { args?: unknown; input?: unknown }).args
        ?? (update as { input?: unknown }).input
        ?? {}
      events.push({
        type: 'content_delta',
        messageId,
        delta: {
          type: 'tool_use',
          toolName: name,
          toolUseId,
          input: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          status: 'streaming',
          startedAt: Date.now(),
        },
      })
      break
    }
    case 'tool-call-completed': {
      const toolUseId = idField(update, 'callId', 'toolCallId', 'id')
      const name = toolDisplayName(strField(update, 'name') || 'Tool')
      const args = (update as { args?: unknown; input?: unknown }).args
        ?? (update as { input?: unknown }).input
        ?? {}
      const result = (update as { result?: unknown }).result
      const isError = Boolean((update as { isError?: boolean }).isError)
      events.push({
        type: 'content_delta',
        messageId,
        delta: {
          type: 'tool_use',
          toolName: name,
          toolUseId,
          input: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          status: 'complete',
        },
      })
      events.push({
        type: 'content_delta',
        messageId,
        delta: {
          type: 'tool_result',
          toolUseId,
          summary: result === undefined
            ? ''
            : typeof result === 'string' ? result : JSON.stringify(result),
          isError,
        },
      })
      break
    }
    case 'turn-ended': {
      events.push({ type: 'status_change', status: 'idle' })
      break
    }
    case 'shell-output-delta': {
      const text = strField(update, 'text') || strField(update, 'stdout') || strField(update, 'chunk')
      if (text) {
        events.push({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text },
        })
      }
      break
    }
    case 'nested-task':
    case 'task-started':
    case 'task-completed': {
      const taskId = idField(update, 'taskId', 'id', 'callId')
      const description = strField(update, 'description') || strField(update, 'text') || 'Task'
      if (type === 'task-started' || type === 'nested-task') {
        events.push({
          type: 'task_started',
          taskId,
          description,
        })
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
    case 'summary':
    case 'summary-started':
    case 'summary-completed': {
      const text = strField(update, 'text') || strField(update, 'summary')
      if (text && type === 'summary-completed') {
        events.push({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: `\n${text}\n` },
        })
      }
      break
    }
    default: {
      // Best-effort: updateTodos-style payloads → todos UI
      const todos = (update as { todos?: unknown }).todos
      if (Array.isArray(todos)) {
        events.push({
          type: 'todos_updated',
          todos: todos.map((todo, index) => {
            const row = (todo && typeof todo === 'object') ? todo as Record<string, unknown> : {}
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
        })
      }
      break
    }
  }
  return events
}

/** Reattach / lifecycle path (D6). */
export function mapSdkMessageLifecycle(
  messageId: string,
  message: SDKMessage,
  options?: { includeContent?: boolean },
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
      events.push({
        type: 'message_usage',
        messageId,
        inputTokens: u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens,
        outputTokens: u.outputTokens + (u.reasoningTokens ?? 0),
      })
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
