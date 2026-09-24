import type { AgentEvent, ChatMessage, ContentBlock, RetractedBlockRef, TodoItem } from '@superone/shared/agent-types'
import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import type { BashEditToolUse } from '@superone/shared/bash-edit-diff'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
// Side-effect type imports: dsh merges each plugin's event vocabulary into
// `SessionEventMap` from the plugin's own package, so a consumer that reads an
// event has to name that package itself. Relying on some other file's runtime
// import to carry the augmentation is how `compaction/*` silently vanished from
// the union when the engine moved to the preset plane.
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-llm-retry'

/**
 * One assistant message per turn, keyed on the turn alone.
 *
 * dsh opens a step per model round trip, so a turn that calls three tools has
 * four of them. A message per step would give every tool call its own bubble
 * and its own token footer, which is not what the user asked for — the turn is.
 * Every step of a turn therefore resolves to the same id, and the derivation
 * stays deterministic so replay produces identical ids.
 */
function turnMessageId(sessionId: string, turn: number): string {
  return `dsh:${sessionId}:${turn}`
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
 * order (`turn/start` → steps → `turn/end`) maps onto the reducer contract
 * (`message_start` → `content_delta`* → `message_complete`) at the TURN
 * bracket, not the step one: the steps inside a turn are the model working, and
 * SuperOne renders one bubble with one footer per thing the user asked for.
 * Carried state is therefore the open turn's message id, the last completed one
 * (interrupt/error attribution), that turn's running spend, and the latest route
 * context window.
 *
 * Text and reasoning are NOT in the log while they stream: since session
 * format v2 the loop publishes them as process-local `agent/assistant-stream`
 * frames and embeds the whole stream in the committed `assistant/message`.
 * The live half arrives through {@link handleStreamFrame}; the log half carries
 * everything else — whole tool calls (`tool/call` → `tool/result`), usage,
 * todos, interrupt/error.
 */
export class DeepseekEventMapper {
  private openMessageId: string | null = null
  private lastMessageId: string | null = null
  /** The open turn's footer spend, summed across its steps. */
  private turnUsage = { input: 0, output: 0, cacheRead: 0 }
  private contextWindow: number | undefined
  private model: string | undefined
  private toolUses = 0
  private totalTokens = 0
  /**
   * What the current model attempt has streamed so far. An attempt that does
   * not commit a message — retried after a transient failure, or abandoned —
   * is retracted from the bubble, so a retry does not show its text twice or
   * leave a tool row that never completes.
   */
  private attempt: { text: string; thinking: string; toolCalls: Set<string> } = emptyAttempt()
  /** Tool calls opened from argument deltas and not yet logged as `tool/call`. */
  private readonly streamingToolCalls = new Set<string>()
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

  /**
   * One live assistant-stream frame for this session's agent.
   *
   * Chunks render as they arrive. A tool call opens its row on its first
   * argument delta (the one carrying the name) and fills the input as it
   * streams — long file writes are otherwise a silent wait — and the durable
   * `tool/call` later completes the same row by id.
   *
   * An attempt that settles without a message (`assistant/attempt`, or an
   * abandoned stream) is retracted: its retry streams again from scratch.
   * @param frame - the frame dsh published.
   */
  handleStreamFrame(frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.attempt = emptyAttempt()
      return
    }
    if (frame.type === 'end') {
      const committed = frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message'
      if (!committed) this.retractAttempt()
      this.attempt = emptyAttempt()
      return
    }
    const chunk = frame.chunk
    if (chunk.type === 'text-delta') {
      this.attempt.text += chunk.text
      this.emitDelta({ type: 'text', text: chunk.text })
    } else if (chunk.type === 'reasoning-delta') {
      this.attempt.thinking += chunk.text
      this.emitDelta({ type: 'thinking', thinking: chunk.text })
    } else if (chunk.type === 'tool-call-delta') {
      this.streamToolCall(String(chunk.id), chunk.name, chunk.argumentsDelta)
    }
  }

  private streamToolCall(toolUseId: string, name: string | undefined, argumentsDelta: string): void {
    if (!this.streamingToolCalls.has(toolUseId)) {
      if (name === undefined) return
      this.streamingToolCalls.add(toolUseId)
      this.attempt.toolCalls.add(toolUseId)
      this.emitDelta({
        type: 'tool_use',
        toolName: displayToolName(name),
        toolUseId,
        input: '',
        status: 'streaming',
      })
    }
    if (argumentsDelta.length === 0) return
    const nested = this.opts.nested
    const messageId = nested ? nested.resolveMessageId() : this.openMessageId
    if (!messageId) return
    this.emit({
      type: 'tool_input_delta',
      messageId,
      toolUseId,
      partialJson: argumentsDelta,
      ...(nested ? { parentToolUseId: nested.parentToolUseId } : {}),
    })
  }

  /** Take back what an attempt that committed nothing already showed. */
  private retractAttempt(): void {
    const blocks: RetractedBlockRef[] = [...this.attempt.toolCalls].map((toolUseId) => ({ type: 'tool_use', toolUseId }))
    for (const toolUseId of this.attempt.toolCalls) this.streamingToolCalls.delete(toolUseId)
    if (this.attempt.text.length > 0) blocks.push({ type: 'text', text: this.attempt.text, fromEnd: true })
    if (this.attempt.thinking.length > 0) blocks.push({ type: 'thinking', thinking: this.attempt.thinking, fromEnd: true })
    const nested = this.opts.nested
    const messageId = nested ? nested.resolveMessageId() : this.openMessageId
    if (blocks.length === 0 || !messageId) return
    this.emit({ type: 'content_retracted', messageId, blocks })
  }

  /**
   * File-edit rows for changes no tool call showed, completed in place.
   * @param rows - one per changed file, from the turn's workspace snapshot.
   */
  emitEditRows(rows: readonly BashEditToolUse[]): void {
    for (const row of rows) {
      this.emitDelta({
        type: 'tool_use',
        toolName: row.toolName,
        toolUseId: row.toolUseId,
        input: row.input,
        status: 'complete',
        toolFilePath: row.filePath,
        ...(!row.pathOnly ? { toolLineDelta: { added: row.added, removed: row.removed } } : {}),
      })
      this.emitDelta({ type: 'tool_result', toolUseId: row.toolUseId, summary: '' })
    }
  }

  handle(event: SessionEvent): void {
    switch (event.type) {
      case 'step/start': {
        // A nested child contributes blocks to its parent's message, never a
        // message of its own — publishing one would break the subagent segment
        // in two and orphan every block after it.
        if (this.opts.nested) break
        const id = turnMessageId(this.opts.sessionId, event.data.turn)
        // The turn's later steps join the message its first step opened.
        // Opening here rather than at `turn/start` means a turn that never
        // reaches the model leaves no empty bubble behind.
        if (this.openMessageId === id) break
        this.openMessageId = id
        this.lastMessageId = id
        this.turnUsage = { input: 0, output: 0, cacheRead: 0 }
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
      case 'tool/call': {
        this.toolUses += 1
        this.streamingToolCalls.delete(String(event.data.callId))
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
        // A first-class `role: 'tool'` message since format v4: its content is
        // the model-facing result itself, not a wrapper block around it.
        const message = event.data.message
        const summary = message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
        const isError = event.data.error !== undefined || message.isError === true
        this.emitDelta({
          type: 'tool_result',
          toolUseId: String(message.toolCallId),
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
          // The footer is the turn's spend, and `message_usage` overwrites it
          // rather than adding, so the running totals are kept here. dsh reports
          // disjoint counts, so cache reads stay OUT of the input line: they are
          // the same prompt re-sent each step, and billing them per step would
          // report a turn that re-read 30k of context four times as 120k spent.
          // This is the accounting Claude already uses (uncached + cache write).
          this.turnUsage = {
            input: this.turnUsage.input + usage.inputTokens + (usage.cacheWriteTokens ?? 0),
            output: this.turnUsage.output + usage.outputTokens,
            cacheRead: this.turnUsage.cacheRead + (usage.cacheReadTokens ?? 0),
          }
          this.emit({
            type: 'message_usage',
            messageId: this.openMessageId,
            inputTokens: this.turnUsage.input,
            outputTokens: this.turnUsage.output,
            ...(this.turnUsage.cacheRead > 0 ? { cacheReadTokens: this.turnUsage.cacheRead } : {}),
            ...(this.model !== undefined ? { model: this.model } : {}),
            // The ring is occupancy, not spend: the latest step's full prompt +
            // completion IS the context right now, so it replaces rather than
            // accumulates.
            contextTokens: billedInput + usage.outputTokens,
            ...(this.contextWindow !== undefined ? { contextWindow: this.contextWindow } : {}),
          })
        }
        break
      }
      case 'turn/end': {
        // A child's abort or error reaches the parent as the delegation tool's
        // errored result. Surfacing it a second time would mark the parent's
        // own message interrupted for a failure it recovered from.
        if (this.opts.nested) break
        const reason = event.data.reason as { kind: string; error?: { message?: string } }
        const id = this.openMessageId ?? this.lastMessageId
        this.openMessageId = null
        if (!id) break
        if (reason.kind === 'aborted') {
          this.emit({ type: 'message_interrupted', messageId: id })
        } else if (reason.kind === 'error') {
          const dshError = reason.error?.message ?? 'model request failed'
          this.emit({ type: 'message_error', messageId: id, error: dshError, errorInfo: buildAgentErrorInfo(dshError) })
        } else {
          // Every other way a turn ends — `completed`, `blocked`, and whatever a
          // plugin merges into the reason map — still ends the reply, so the
          // bubble has to stop streaming. Only the two failures above get their
          // own terminal event.
          this.emit({
            type: 'message_complete',
            messageId: id,
            // dsh forks at an inclusive event seq, so the anchor for "fork from
            // this message" is the seq that closed its turn. Carried on the
            // shared `forkAnchorId` seam the other harnesses use for their own
            // native ids.
            metadata: { forkAnchorId: String(event.seq) },
          })
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
      // `llm-retry` logs one of these before each backoff wait; the retry itself
      // re-runs the step inside the same turn, so the bubble stays open.
      case 'llm/retry': {
        if (this.opts.nested) break
        this.emit({
          type: 'api_retry',
          attempt: event.data.retry,
          ...(event.data.mode === 'normal' ? { maxRetries: event.data.maxRetries } : {}),
          delayMs: event.data.delayMs,
          message: event.data.failure.message,
          phase: 'retrying',
        })
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

function emptyAttempt(): { text: string; thinking: string; toolCalls: Set<string> } {
  return { text: '', thinking: '', toolCalls: new Set() }
}

export function displayToolName(name: string): string {
  return CANONICAL_TOOL_NAMES[name] ?? name
}
