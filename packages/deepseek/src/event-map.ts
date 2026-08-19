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
  /**
   * Render this session as a delegated child *inside* its parent's transcript.
   *
   * A child has its own dsh session and its own turns, but SuperOne's subagent
   * renderer rebuilds the tree from `parentToolUseId` stamps on the blocks of
   * ONE message — the message holding the `Task` tool call. So a nested mapper
   * publishes no message of its own: it addresses the parent's open message and
   * stamps every block with the parent's `subagent` call id.
   */
  nested?: {
    parentToolUseId: string
    /** The parent's currently open message id, read at emit time. */
    resolveMessageId: () => string | null
  }
}

/** What a nested child accumulated, for the parent's Task chip. */
export interface DeepseekChildStats {
  toolUses: number
  totalTokens: number
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
  private toolUses = 0
  private totalTokens = 0
  /** Open compaction bracket, from `compaction/start` to `compaction/end`. */
  private compaction: {
    trigger: 'manual' | 'auto'
    preTokens?: number
    postTokens?: number
  } | null = null

  constructor(private readonly opts: DeepseekMapperOptions) {}

  /** Running totals for the parent's Task chip; only meaningful when nested. */
  stats(): DeepseekChildStats {
    return { toolUses: this.toolUses, totalTokens: this.totalTokens }
  }

  /**
   * The message this session is currently streaming into, if any. A child's
   * nested mapper reads its parent's, because that is the message its blocks
   * have to join.
   */
  currentMessageId(): string | null {
    return this.openMessageId ?? this.lastMessageId
  }

  private emit(event: AgentEvent): void {
    this.opts.emit(event)
  }

  /**
   * The block kinds this mapper produces. Narrower than `ContentBlock` so the
   * nested stamp below stays a checked property write: a few Codex-only
   * variants carry no `parentToolUseId` and could not be nested at all.
   */
  private emitDelta(delta: Extract<ContentBlock, { parentToolUseId?: string | null }>): void {
    const nested = this.opts.nested
    const messageId = nested ? nested.resolveMessageId() : this.openMessageId
    if (!messageId) return
    this.emit({
      type: 'content_delta',
      messageId,
      delta: nested ? { ...delta, parentToolUseId: nested.parentToolUseId } : delta,
      ...(this.opts.isReplay ? { isReplay: true } : {}),
    })
  }

  handle(event: SessionEvent): void {
    switch (event.type) {
      case 'step/start': {
        // A nested child contributes blocks to its parent's message, never a
        // message of its own — publishing one would break the subagent segment
        // in two and orphan every block after it.
        if (this.opts.nested) break
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
        this.toolUses += 1
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
        if (!usage) break
        const nested = this.opts.nested
        if (nested) {
          // A child's spend belongs to the parent's Task chip, not to the
          // session's context ring — its context is its own and disposable.
          const messageId = nested.resolveMessageId()
          this.totalTokens += usage.inputTokens + usage.outputTokens
          if (messageId) {
            this.emit({
              type: 'subagent_usage',
              messageId,
              parentToolUseId: nested.parentToolUseId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            })
          }
          break
        }
        if (this.openMessageId) {
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
          this.emit({
            type: 'message_complete',
            messageId: this.openMessageId,
            // dsh forks at an inclusive event seq, so the anchor for "fork from
            // this message" is the seq that closed its step. Carried on the
            // shared `forkAnchorId` seam the other harnesses use for their own
            // native ids.
            metadata: { forkAnchorId: String(event.seq) },
          })
          this.openMessageId = null
        }
        break
      }
      case 'turn/end': {
        // A child's abort or error reaches the parent as the delegation tool's
        // errored result. Surfacing it a second time would mark the parent's
        // own message interrupted for a failure it recovered from.
        if (this.opts.nested) break
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
        // `todos_updated` is session-wide state, so a child writing its own plan
        // would overwrite the panel the user is watching.
        if (this.opts.nested) break
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
      // --- Compaction -----------------------------------------------------
      // dsh brackets one compaction with `start` … `summary` … `end`, and the
      // surface replacement rides a `user/message` between the last two. Only
      // the bracket is mapped: the replacement is a shadow of history the chat
      // already shows, so rendering it would duplicate the transcript.
      case 'compaction/start': {
        if (this.opts.nested) break
        // `turn: null` is dsh's marker for a standalone manual transaction
        // between turns; a numbered owner means the pressure listener fired
        // inside an open turn.
        this.compaction = { trigger: event.data.turn === null ? 'manual' : 'auto' }
        this.emit({ type: 'status_indicator', indicator: 'compacting' })
        break
      }
      case 'compaction/summary': {
        if (!this.compaction) break
        this.compaction.preTokens = event.data.shadowedTokenCount
        // What the shadowed range costs from here on is the summary itself.
        this.compaction.postTokens = event.data.usage?.outputTokens
        break
      }
      case 'compaction/end': {
        const compaction = this.compaction
        if (!compaction) break
        this.compaction = null
        const error = event.data.error
        if (error !== undefined) {
          this.emit({
            type: 'status_indicator',
            indicator: null,
            compactResult: 'failed',
            compactError: error,
          })
          break
        }
        this.emit({
          type: 'compact_boundary',
          trigger: compaction.trigger,
          preTokens: compaction.preTokens ?? 0,
          ...(compaction.postTokens !== undefined ? { postTokens: compaction.postTokens } : {}),
          ...(this.lastMessageId ? { messageId: this.lastMessageId } : {}),
        })
        this.emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
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
  // `isSubagentToolName()` matches `Agent`/`Task` exactly — that string is what
  // switches the block from a generic tool row to the collapsible subagent
  // segment that collects the child's `parentToolUseId`-stamped blocks. Both
  // delegation providers render as the same block; which one ran is visible in
  // the call's own arguments.
  subagent: 'Task',
  subagent_fork: 'Task',
}

export function displayToolName(name: string): string {
  return CANONICAL_TOOL_NAMES[name] ?? name
}
