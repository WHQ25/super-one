import type {
  ConversationStep,
  InteractionUpdate,
  SDKMessage,
  SDKToolUseMessage,
} from '@cursor/sdk'
import type { AgentEvent, ContextUsageInfo } from '@superone/shared/agent-types'
import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import { formatTranscriptToolResult, normalizeTranscriptTool } from '@superone/shared/tool-ui'

/** Map Cursor toolCall.type (and free-form names) to SuperOne tool display names. */
export function toolDisplayName(name: string): string {
  if (name.startsWith('mcp__')) return name
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

/**
 * Cursor wraps every MCP call as ToolType `mcp` with
 * `{ providerIdentifier, toolName, args }`. Rebuild the canonical
 * `mcp__<server>__<tool>` that `parseMcpToolName` expects — same unwrap
 * ACP does for Grok's `use_tool` envelope.
 */
export function unwrapCursorMcpTool(
  toolType: string,
  args: unknown,
): { toolType: string; args: unknown } {
  if (toolType.toLowerCase() !== 'mcp') return { toolType, args }
  const rec = asRecord(args)
  if (!rec) return { toolType, args }
  const server = typeof rec.providerIdentifier === 'string' ? rec.providerIdentifier.trim() : ''
  const name = typeof rec.toolName === 'string' ? rec.toolName.trim() : ''
  if (!server || !name) return { toolType, args }
  return { toolType: `mcp__${server}__${name}`, args: rec.args ?? {} }
}

function strField(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') return ''
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

/** Keys that identify a Cursor tool call — never ConversationStep.`id` (a step uuid). */
const TOOL_CALL_ID_KEYS = ['callId', 'toolCallId', 'call_id'] as const

/** Real call id only — never invents `tool_<timestamp>` placeholders. */
export function stableIdField(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  for (const key of keys) {
    const v = rec[key]
    if (typeof v === 'string' && v) return v
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

function idField(obj: unknown, ...keys: string[]): string {
  return stableIdField(obj, ...keys) ?? `tool_${Date.now()}`
}

/**
 * Stable Cursor tool-call id from a delta or ConversationStep.
 * Skips generic `id` so an onStep uuid cannot fork a second ToolBlock.
 */
export function extractCursorCallId(update: unknown): string | null {
  const rec = asRecord(update)
  if (!rec) return null
  const nested = asRecord(rec.toolCall) ?? asRecord(rec.message)
  return stableIdField(rec, ...TOOL_CALL_ID_KEYS)
    ?? (nested ? stableIdField(nested, ...TOOL_CALL_ID_KEYS) : null)
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
  callId: string | null
  toolType: string
  args: unknown
  result: unknown
  isError: boolean
} {
  const rec = asRecord(update) ?? {}
  const callId = extractCursorCallId(update)
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
  const unwrapped = unwrapCursorMcpTool(toolType, args)
  const toolName = toolDisplayName(unwrapped.toolType)
  return {
    type: 'content_delta',
    messageId,
    delta: {
      type: 'tool_use',
      toolName,
      toolUseId: callId,
      input: stringifyPayload(normalizeCursorToolInput(toolName, unwrapped.args)),
      status,
      ...(status === 'streaming' ? { startedAt: Date.now() } : {}),
    },
  }
}

/**
 * Map Cursor native args (`path`, `fileText`, `globPattern`, …) onto the
 * Claude-shaped fields ToolBlock reads (`file_path`, `content`, `pattern`).
 * MCP tools already carry their real input after unwrap.
 */
function normalizeCursorToolInput(toolName: string, args: unknown): unknown {
  if (toolName.startsWith('mcp__')) return args
  const rec = asRecord(args)
  if (!rec) return args ?? {}
  return normalizeTranscriptTool(toolName, rec).input
}

/** Cursor Edit reports a unified diff on the result, not old/new strings in args. */
function mergeCursorToolResultArgs(toolType: string, args: unknown, result: unknown): unknown {
  if (toolType.toLowerCase() === 'mcp') return args
  const res = asRecord(result)
  if (!res) return args
  const rec = asRecord(args)
  if (!rec) return args
  const diff = typeof res.diffString === 'string' ? res.diffString : undefined
  const linesAdded = typeof res.linesAdded === 'number' ? res.linesAdded : undefined
  const linesRemoved = typeof res.linesRemoved === 'number' ? res.linesRemoved : undefined
  if (!diff && linesAdded == null && linesRemoved == null) return args
  const next = { ...rec }
  let changed = false
  if (diff && rec.diffString == null && rec.diff == null) {
    next.diffString = diff
    changed = true
  }
  if (linesAdded != null && rec.linesAdded == null) {
    next.linesAdded = linesAdded
    changed = true
  }
  if (linesRemoved != null && rec.linesRemoved == null) {
    next.linesRemoved = linesRemoved
    changed = true
  }
  return changed ? next : rec
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
      summary: formatTranscriptToolResult(result) || stringifyPayload(result),
      isError,
    },
  }
}

type CursorUsageFields = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
}

/**
 * Rough chars→tokens ratios for the content we can see (prose, code, JSON tool
 * payloads). ASCII text runs ~3.5 chars per token; CJK and other non-ASCII
 * scripts tokenize far denser. Only the *growth within a turn* is estimated
 * with these; the anchor (`inputTokens`) is exact, so the error stays bounded.
 */
const ASCII_CHARS_PER_TOKEN = 3.5
const NON_ASCII_CHARS_PER_TOKEN = 1.5
const NON_ASCII_RE = /[^\x00-\x7f]/g

/** Estimated token count of streamed text or a serialized tool payload. */
function estimateTokens(text: string): number {
  if (!text) return 0
  const nonAscii = text.match(NON_ASCII_RE)?.length ?? 0
  return (text.length - nonAscii) / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN
}

/** `modelCallId` is `<runUuid>-<index>-<rand>`; `index` counts model calls in the run. */
const MODEL_CALL_INDEX_RE = /-(\d+)-[^-]+$/

/** Zero-based model-call index carried by a tool-call delta's `modelCallId`, if parseable. */
export function modelCallIndexFromId(modelCallId: unknown): number | null {
  if (typeof modelCallId !== 'string') return null
  const match = MODEL_CALL_INDEX_RE.exec(modelCallId)
  if (!match) return null
  const index = Number(match[1])
  return Number.isInteger(index) && index >= 0 ? index : null
}

/**
 * Per-send usage with *context* semantics rather than billing semantics.
 *
 * Cursor reports one `turn-ended.usage` per send whose `inputTokens` is the sum
 * of every model call's prompt in the tool loop (each call re-sends the whole
 * context), and `inputTokens` already includes cache reads/writes. It is
 * therefore neither the context occupancy nor "what this turn added". The SDK
 * exposes no per-call usage, so occupancy is solved from what we do have:
 *
 *   I = Σ p_k,  p_k = p_1 + Σ_{j<k} Δ_j
 *
 * where `I` is the exact `inputTokens`, `n` is the model-call count (from
 * `modelCallId` indices) and `Δ_k` is the content each call appended (its text,
 * tool args and tool results — all of which stream through this mapper).
 *
 * Footer semantics: `input` is how much the *input side* grew the window this
 * turn (user prompt + tool results, estimated), `output` is the model's output
 * (`token-delta` live, exact `outputTokens` at turn end).
 */
export class CursorTurnUsage {
  input: number
  output = 0
  /** Estimated context occupancy after this turn (0 until `turn-ended`). */
  context = 0
  /** Estimated tokens appended by each model call, indexed by model-call index. */
  private readonly callTokens: number[] = []
  /** Text streamed since the last tool call; belongs to the next call seen. */
  private pendingTextTokens = 0
  private currentCallIndex = 0
  private sawToolCallComplete = false

  constructor(prompt = '') {
    this.input = Math.round(estimateTokens(prompt))
  }

  addTokenDelta(tokens: number): void {
    if (Number.isFinite(tokens) && tokens > 0) this.output += tokens
  }

  /** Streamed assistant text (thinking is not re-sent to the model, skip it). */
  addText(text: string): void {
    this.pendingTextTokens += estimateTokens(text)
  }

  /** A tool call was issued: the text streamed before it belongs to the same model call. */
  observeToolCallStarted(modelCallId: unknown): void {
    const index = this.resolveCallIndex(modelCallId, true)
    this.bumpCall(index, this.pendingTextTokens)
    this.pendingTextTokens = 0
  }

  /**
   * A tool call finished: its final args (model output) and result (input-side
   * growth for the next call) both land in the context.
   */
  observeToolCallCompleted(modelCallId: unknown, args: string, result: string): void {
    const index = this.resolveCallIndex(modelCallId, false)
    const resultTokens = estimateTokens(result)
    this.bumpCall(index, estimateTokens(args) + resultTokens)
    this.sawToolCallComplete = true
    this.input += Math.round(resultTokens)
  }

  applyInternalTurn(usage: CursorUsageFields): void {
    if (usage.outputTokens > this.output) this.output = usage.outputTokens
    this.context = this.estimateOccupancy(usage.inputTokens)
  }

  /** Run totals only refine output; billed input never reaches the footer. */
  applyRunTotals(usage: CursorUsageFields): void {
    if (usage.outputTokens > this.output) this.output = usage.outputTokens
  }

  /**
   * Solve the last prompt from the summed prompts and the observed increments,
   * then add the final answer so the value is what the *next* prompt carries.
   */
  estimateOccupancy(inputTokens: number): number {
    const increments = this.callTokens.map((tokens) => tokens ?? 0)
    // The final answer is its own model call unless nothing at all was seen.
    if (this.pendingTextTokens > 0 || increments.length === 0) {
      increments.push(this.pendingTextTokens)
    }
    const n = increments.length
    let summedPrefixes = 0
    let prefix = 0
    for (const inc of increments) {
      summedPrefixes += prefix
      prefix += inc
    }
    const firstPrompt = Math.max(0, (inputTokens - summedPrefixes) / n)
    return Math.round(firstPrompt + prefix)
  }

  private resolveCallIndex(modelCallId: unknown, isStart: boolean): number {
    const parsed = modelCallIndexFromId(modelCallId)
    if (parsed != null) {
      this.currentCallIndex = Math.max(this.currentCallIndex, parsed)
      this.sawToolCallComplete = false
      return parsed
    }
    // No parseable id: a call *started* after some result landed opens a new
    // model call; parallel tool batches (start, start, done, done) stay together.
    if (isStart && this.sawToolCallComplete) {
      this.currentCallIndex += 1
      this.sawToolCallComplete = false
    }
    return this.currentCallIndex
  }

  private bumpCall(index: number, tokens: number): void {
    while (this.callTokens.length <= index) this.callTokens.push(0)
    this.callTokens[index] = (this.callTokens[index] ?? 0) + tokens
  }
}

/**
 * Context ring payload. The SDK has no context-window field and its usage
 * breakdown is billing (summed across the tool loop), so no categories are
 * reported — the host falls back to a single "tokens" segment.
 */
export function mapCursorContextUsageInfo(
  occupancyTokens: number,
  extras?: { maxTokens?: number | null; model?: string },
): ContextUsageInfo {
  const occupancy = occupancyTokens > 0 ? occupancyTokens : 0
  const maxTokens = extras?.maxTokens && extras.maxTokens > 0 ? extras.maxTokens : 0
  return {
    categories: [],
    totalTokens: occupancy,
    maxTokens,
    percentage: maxTokens > 0 ? Math.min(100, Math.round((occupancy / maxTokens) * 1000) / 10) : 0,
    model: extras?.model ?? '',
  }
}

export interface MapInteractionOptions {
  /** Optional context window for turn-ended / token usage events. */
  contextWindow?: number | null
  /** Per-send accumulator so token-delta does not wipe input. */
  turnUsage?: CursorTurnUsage
  /**
   * Nested `tool-call-delta.taskUpdate` ownership. Chat grouping only nests
   * blocks whose `parentToolUseId` points at the launching Agent/Task tool.
   */
  parentToolUseId?: string
}

/**
 * Attribute nested content to the launching task tool. Already-stamped
 * parents win so a second nesting level (task inside task) keeps its own id.
 */
function stampParentToolUseId(events: AgentEvent[], parentToolUseId: string | undefined): AgentEvent[] {
  if (!parentToolUseId) return events
  return events.map((event) => {
    if (event.type !== 'content_delta') return event
    const delta = event.delta
    if ('parentToolUseId' in delta && delta.parentToolUseId) return event
    return { ...event, delta: { ...delta, parentToolUseId } }
  })
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
  // Nested sub-agent traffic lives in the sub-agent's own context; only the
  // top-level stream grows this session's window.
  const turnUsage = options?.parentToolUseId ? undefined : options?.turnUsage

  switch (type) {
    case 'text-delta': {
      const text = strField(update, 'text')
      if (text) {
        turnUsage?.addText(text)
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
      if (!parts.callId) break
      if (type === 'tool-call-started') turnUsage?.observeToolCallStarted(rec.modelCallId)
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
          toolUseId: parts.callId,
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
        const parentCallId = extractCursorCallId(rec) ?? options?.parentToolUseId
        events.push(...mapInteractionUpdate(messageId, taskUpdate as InteractionUpdate, {
          ...options,
          ...(parentCallId ? { parentToolUseId: parentCallId } : {}),
        }))
      }
      break
    }
    case 'tool-call-completed': {
      const parts = extractToolCallParts(update)
      if (!parts.callId) break
      turnUsage?.observeToolCallCompleted(
        rec.modelCallId,
        stringifyPayload(parts.args),
        stringifyPayload(parts.result),
      )
      const args = mergeCursorToolResultArgs(parts.toolType, parts.args, parts.result)
      events.push(toolUseEvent(messageId, parts.callId, parts.toolType, args, 'complete'))
      events.push(toolResultEvent(messageId, parts.callId, parts.result, parts.isError))
      if (parts.toolType === 'updateTodos' || parts.toolType === 'update_todos') {
        const todos = asRecord(parts.args)?.todos ?? asRecord(parts.result)?.todos
        const todoEvent = mapTodosPayload(todos)
        if (todoEvent) events.push(todoEvent)
      }
      if (parts.toolType === 'task') {
        const transcriptPath = strField(parts.result, 'transcriptPath')
        events.push({
          type: 'task_notification',
          taskId: parts.callId,
          toolUseId: parts.callId,
          taskStatus: parts.isError ? 'failed' : 'completed',
          outputFile: transcriptPath,
          summary: strField(parts.result, 'resultSuffix')
            || stringifyPayload(parts.result)
            || strField(parts.args, 'description')
            || 'Task',
        })
      }
      break
    }
    case 'token-delta': {
      const tokens = Number((update as { tokens?: number }).tokens)
      if (Number.isFinite(tokens) && tokens > 0) {
        if (turnUsage) turnUsage.addTokenDelta(tokens)
        events.push({
          type: 'message_usage',
          messageId,
          inputTokens: turnUsage?.input ?? 0,
          outputTokens: turnUsage?.output ?? tokens,
        })
      }
      break
    }
    case 'turn-ended': {
      const usage = (update as { usage?: CursorUsageFields }).usage
      // Without a per-send accumulator the billed aggregate cannot be turned into
      // context numbers, so nothing is reported rather than something 4–8× off.
      if (usage && turnUsage) {
        turnUsage.applyInternalTurn(usage)
        events.push({
          type: 'message_usage',
          messageId,
          inputTokens: turnUsage.input,
          outputTokens: turnUsage.output,
          cacheReadTokens: usage.cacheReadTokens,
          contextTokens: turnUsage.context,
          ...(options?.contextWindow && options.contextWindow > 0
            ? { contextWindow: options.contextWindow }
            : {}),
        })
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
  return stampParentToolUseId(events, options?.parentToolUseId)
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
    const callId = extractCursorCallId(rec) || options?.resolveCallId?.(step) || null
    if (!callId) {
      // No stable id — onDelta already owns the real tool_use row.
      return events
    }
    const toolType = nested && typeof nested.type === 'string' && nested.type
      ? nested.type
      : (strField(rec, 'name') || 'Tool')
    const args = nested?.args ?? nested?.input ?? {}
    const resultRec = asRecord(nested?.result)
    const resultValue = resultRec?.status === 'success'
      ? (resultRec.value ?? nested?.result)
      : nested?.result
    events.push(toolUseEvent(
      messageId,
      callId,
      toolType,
      mergeCursorToolResultArgs(toolType, args, resultValue),
      'complete',
    ))
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
    if (type === 'tool-call-delta') {
      const taskUpdate = asRecord(update)?.taskUpdate
      if (taskUpdate && typeof taskUpdate === 'object') {
        this.observeDelta(taskUpdate as InteractionUpdate)
      }
      return
    }
    if (
      type !== 'tool-call-started'
      && type !== 'partial-tool-call'
      && type !== 'tool-call-completed'
    ) {
      return
    }
    const callId = extractCursorCallId(update)
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
        const cursorError = message.message ?? 'Cursor run error'
        events.push({ type: 'message_error', messageId, error: cursorError, errorInfo: buildAgentErrorInfo(cursorError) })
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
      // Same billed aggregate as `turn-ended`, which the delta path already turned
      // into context numbers; re-emitting the raw sum here would overwrite them.
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
            events.push(toolUseEvent(messageId, block.id, block.name, block.input, 'streaming'))
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
  const status = message.status === 'completed' || message.status === 'error' ? 'complete' : 'streaming'
  const args = status === 'complete'
    ? mergeCursorToolResultArgs(message.name, message.args, message.result)
    : message.args
  const events: AgentEvent[] = [
    toolUseEvent(messageId, message.call_id, message.name, args, status),
  ]
  if (message.status === 'completed' || message.status === 'error') {
    events.push(toolResultEvent(messageId, message.call_id, message.result, message.status === 'error'))
  }
  return events
}
