import type { AgentEvent, ChatMessage, ContentBlock, TodoItem } from '@superone/shared/agent-types'
import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Message id derivation is deterministic so replay produces identical ids. */
function stepMessageId(sessionId: string, turn: number, step: number): string {
  return `dsh:${sessionId}:${turn}:${step}`
}

export interface DeepseekMapperOptions {
  sessionId: string
  emit: (event: AgentEvent) => void
  /** Mark mapped events as replay (seed history) so consumers skip side effects. */
  isReplay?: boolean
}

/**
 * Maps the dsh session log (`session/event`) onto SuperOne `AgentEvent`s.
 *
 * One instance per live agent. The dsh log is seq-contiguous and its happy
 * order (`step/start` → chunks → `step/end`) matches the reducer contract
 * (`message_start` → `content_delta`* → `message_complete`), so this stays a
 * stateless-ish transducer: the only carried state is the open step's message
 * id, the last completed one (interrupt/error attribution), and the latest
 * route context window.
 *
 * P1 scope: text/thinking streaming, whole tool calls (`tool/call` →
 * `tool/result`; streaming tool-input deltas come with the
 * supportsStreamingToolInput flag later), usage, todos, interrupt/error.
 */
export class DeepseekEventMapper {
  private openMessageId: string | null = null
  private lastMessageId: string | null = null
  private contextWindow: number | undefined
  private model: string | undefined

  constructor(private readonly opts: DeepseekMapperOptions) {}

  private emit(event: AgentEvent): void {
    this.opts.emit(event)
  }

  private emitDelta(delta: ContentBlock): void {
    if (!this.openMessageId) return
    this.emit({
      type: 'content_delta',
      messageId: this.openMessageId,
      delta,
      ...(this.opts.isReplay ? { isReplay: true } : {}),
    })
  }

  handle(event: SessionEvent): void {
    switch (event.type) {
      case 'step/start': {
        const id = stepMessageId(this.opts.sessionId, event.data.turn, event.data.step)
        this.openMessageId = id
        this.lastMessageId = id
        const message: ChatMessage = {
          id,
          role: 'assistant',
          status: 'streaming',
          content: [],
          createdAt: new Date(event.time).toISOString(),
          providerId: 'dsh',
        }
        this.emit({ type: 'message_start', message })
        break
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type === 'text-delta') {
          this.emitDelta({ type: 'text', text: chunk.text })
        } else if (chunk.type === 'reasoning-delta') {
          this.emitDelta({ type: 'thinking', thinking: chunk.text })
        }
        // tool-call chunks are mapped from the durable tool/call event instead;
        // block-start/block-end/usage/finish carry no additional UI information here.
        break
      }
      case 'tool/call': {
        this.emitDelta({
          type: 'tool_use',
          toolName: displayToolName(event.data.name),
          toolUseId: String(event.data.callId),
          input: event.data.arguments,
          status: 'complete',
        })
        break
      }
      case 'tool/result': {
        const content = event.data.message.content ?? []
        const summary = content
          .map((block) => {
            if (block.type === 'tool-result') {
              return block.content
                .map((inner) => (inner.type === 'text' ? inner.text : ''))
                .join('')
            }
            return ''
          })
          .join('')
        const isError = event.data.error !== undefined
          || content.some((block) => block.type === 'tool-result' && block.isError)
        this.emitDelta({
          type: 'tool_result',
          toolUseId: String(event.data.message.source && 'callId' in event.data.message.source
            ? event.data.message.source.callId
            : ''),
          summary,
          ...(isError ? { isError: true } : {}),
        })
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage && this.openMessageId) {
          const billedInput = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
          this.emit({
            type: 'message_usage',
            messageId: this.openMessageId,
            inputTokens: billedInput,
            outputTokens: usage.outputTokens,
            ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(this.model !== undefined ? { model: this.model } : {}),
            // The step's full prompt + completion is the session's context
            // occupancy after this step — that pair drives the context ring.
            contextTokens: billedInput + usage.outputTokens,
            ...(this.contextWindow !== undefined ? { contextWindow: this.contextWindow } : {}),
          })
        }
        break
      }
      case 'step/end': {
        if (this.openMessageId) {
          this.emit({ type: 'message_complete', messageId: this.openMessageId })
          this.openMessageId = null
        }
        break
      }
      case 'turn/end': {
        const reason = event.data.reason as { kind: string; error?: { message?: string } }
        if (reason.kind === 'aborted') {
          const id = this.openMessageId ?? this.lastMessageId
          if (id) this.emit({ type: 'message_interrupted', messageId: id })
          this.openMessageId = null
        } else if (reason.kind === 'error') {
          const id = this.openMessageId ?? this.lastMessageId
          if (id) {
            const dshError = reason.error?.message ?? 'model request failed'
            this.emit({ type: 'message_error', messageId: id, error: dshError, errorInfo: buildAgentErrorInfo(dshError) })
          }
          this.openMessageId = null
        }
        break
      }
      case 'todo/write': {
        const todos: TodoItem[] = event.data.todos.map((todo, index) => ({
          // dsh todos are whole-list snapshots without identity; a positional id
          // is stable enough because every write replaces the list.
          id: String(index),
          subject: todo.content,
          description: '',
          status: todo.status,
        }))
        this.emit({ type: 'todos_updated', todos })
        break
      }
      case 'request/context': {
        this.contextWindow = event.data.contextWindow
        this.model = event.data.model
        break
      }
      default:
        break
    }
  }
}

/**
 * dsh's native tool names in the vocabulary the chat renderers already speak.
 *
 * The argument shapes are the same (`file_path`, `command`, `old_string`, …),
 * so renaming the call is all it takes for dsh to reuse the Bash terminal view,
 * the edit diff, and the todo panel instead of falling back to a generic row.
 * Anything not in this table — MCP tools, dsh tools we do not mount — keeps its
 * own name.
 */
const CANONICAL_TOOL_NAMES: Record<string, string> = {
  read: 'Read',
  read_image: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  glob: 'Glob',
  grep: 'Grep',
  todo_write: 'TodoWrite',
}

export function displayToolName(name: string): string {
  return CANONICAL_TOOL_NAMES[name] ?? name
}
