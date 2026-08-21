/**
 * Electron-free Codex App Server notification -> SuperOne AgentEvent mapping.
 *
 * This mirrors the desktop Codex turn/backend semantics. Hosts own transport
 * and process lifecycle; this mapper owns item state and message projection.
 */
import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import {
  readCodexAgentMessageDelivery,
  readCodexErrorOverrides,
  readCodexImageGenerationFailure,
} from './protocol-v149'
import type {
  AgentEvent,
  CodexCollabAgentState,
  CodexCollabAgentStatus,
  CodexCollabTool,
  CodexCommandExecutionStatus,
  CodexMcpServerStartup,
  CodexMcpToolCallStatus,
  CodexPatchApplyStatus,
  CodexPatchChangeKind,
  CodexReasoningItem,
  CodexThreadItem,
  CodexUsageInfo,
} from '@superone/shared/agent-types'

export interface CodexAppServerNotification {
  method: string
  params: Record<string, unknown>
}

export interface CodexAgentEventMapperOptions {
  messageId: string
  emit: (event: AgentEvent) => void
  model?: string
  turnId?: string | null
  turnKind?: 'run' | 'steer' | 'review' | 'compact'
  now?: () => number
}

export interface CodexNotificationApplyResult {
  textDelta: string | null
  completed: boolean
  error: string | null
  interrupted: boolean
}

export interface CodexAgentEventMapper {
  start(threadId: string | null): void
  apply(notification: CodexAppServerNotification): CodexNotificationApplyResult
  fail(error: string, interrupted?: boolean): void
  items(): CodexThreadItem[]
  usage(): CodexUsageInfo | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(readString).filter((entry): entry is string => entry !== null)
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = []
  for (const value of values) {
    if (!value || result.includes(value)) continue
    result.push(value)
  }
  return result
}

function readTextPart(value: unknown): string | null {
  const direct = readString(value)
  if (direct !== null) return direct
  const rec = asRecord(value)
  if (!rec) return null
  return readString(rec.text)
    ?? readString(rec.summaryText)
    ?? readString(rec.summary_text)
    ?? readString(rec.content)
}

function readTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(readTextPart)
    .filter((entry): entry is string => entry !== null && entry.length > 0)
}

export function readCodexItemId(rec: Record<string, unknown>): string | null {
  return readString(rec.itemId)
    ?? readString(rec.item_id)
    ?? readString(rec.id)
    ?? readString(asRecord(rec.item)?.id)
}

export function readCodexDeltaText(rec: Record<string, unknown>): string {
  return readString(rec.delta)
    ?? readString(rec.textDelta)
    ?? readString(rec.text_delta)
    ?? readString(rec.summaryTextDelta)
    ?? readString(rec.summary_text_delta)
    ?? readString(rec.summaryDelta)
    ?? readString(rec.summary_delta)
    ?? readString(rec.text)
    ?? readString(rec.summaryText)
    ?? readString(rec.summary_text)
    ?? ''
}

function mapPatchChangeKind(raw: unknown): CodexPatchChangeKind {
  const direct = readString(raw)
  if (direct === 'add' || direct === 'delete' || direct === 'update') return direct
  const kind = readString(asRecord(raw)?.type)
  return kind === 'add' || kind === 'delete' || kind === 'update' ? kind : 'update'
}

function mapCommandExecutionStatus(raw: unknown): CodexCommandExecutionStatus {
  switch (readString(raw)) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
    case 'declined':
      return 'failed'
    default:
      return 'completed'
  }
}

function mapPatchApplyStatus(raw: unknown): CodexPatchApplyStatus {
  const status = readString(raw)
  return status === 'failed' || status === 'declined' ? 'failed' : 'completed'
}

function mapMcpToolCallStatus(raw: unknown): CodexMcpToolCallStatus {
  switch (readString(raw)) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
      return 'failed'
    default:
      return 'completed'
  }
}

function normalizeCollabTool(value: unknown): CodexCollabTool | null {
  switch (readString(value)) {
    case 'spawnAgent':
    case 'spawn_agent':
      return 'spawnAgent'
    case 'sendInput':
    case 'send_input':
      return 'sendInput'
    case 'wait':
    case 'wait_agent':
      return 'wait'
    case 'closeAgent':
    case 'close_agent':
      return 'closeAgent'
    case 'resumeAgent':
    case 'resume_agent':
      return 'resumeAgent'
    default:
      return null
  }
}

function normalizeCollabAgentStatus(value: unknown): CodexCollabAgentStatus | null {
  switch (readString(value)) {
    case 'pendingInit':
    case 'pending_init':
      return 'pendingInit'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'errored':
    case 'error':
      return 'errored'
    case 'shutdown':
      return 'shutdown'
    case 'notFound':
    case 'not_found':
      return 'notFound'
    default:
      return null
  }
}

export function buildCodexReasoningItem(
  id: string,
  text: string,
  previous?: CodexThreadItem,
  now: () => number = Date.now,
): CodexReasoningItem {
  const timestamp = now()
  const startedAt = previous?.type === 'reasoning' ? (previous.startedAt ?? timestamp) : timestamp
  return { id, type: 'reasoning', text, startedAt, endedAt: timestamp }
}

export function mapCodexThreadItem(
  raw: unknown,
  previous?: CodexThreadItem,
  now: () => number = Date.now,
): CodexThreadItem | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const type = readString(rec.type)
  const id = readString(rec.id) ?? previous?.id
  if (!type || !id) return null

  switch (type) {
    case 'agent_message':
    case 'agentMessage':
      return {
        id,
        type: 'agent_message',
        text: readString(rec.text) ?? (previous?.type === 'agent_message' ? previous.text : ''),
        ...(readCodexAgentMessageDelivery(rec.delivery)
          ?? (previous?.type === 'agent_message' ? previous.delivery : undefined)
          ? { delivery: 'async' as const }
          : {}),
      }
    case 'reasoning': {
      const text = readString(rec.text)
        || readTextParts(rec.summary).join('\n\n')
        || readTextParts(rec.content).join('\n\n')
        || (previous?.type === 'reasoning' ? previous.text : '')
      return buildCodexReasoningItem(id, text, previous, now)
    }
    case 'command_execution':
    case 'commandExecution': {
      const prev = previous?.type === 'command_execution' ? previous : null
      const actions = Array.isArray(rec.commandActions)
        ? rec.commandActions.map((entry) => {
            const action = asRecord(entry)
            if (!action) return null
            return {
              type: readString(action.type) ?? 'unknown',
              ...(action.command != null ? { command: readString(action.command) ?? undefined } : {}),
              ...(action.name != null ? { name: readString(action.name) ?? undefined } : {}),
              ...(action.path != null ? { path: readString(action.path) ?? undefined } : {}),
              ...(action.query != null ? { query: readString(action.query) ?? undefined } : {}),
            }
          }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : undefined
      const exitCode = readNumber(rec.exitCode) ?? readNumber(rec.exit_code)
      return {
        id,
        type: 'command_execution',
        command: readString(rec.command) ?? prev?.command ?? '',
        aggregatedOutput: readString(rec.aggregatedOutput)
          ?? readString(rec.aggregated_output)
          ?? prev?.aggregatedOutput
          ?? '',
        ...(exitCode !== null ? { exitCode } : {}),
        status: mapCommandExecutionStatus(rec.status ?? prev?.status),
        ...(actions ? { commandActions: actions } : prev?.commandActions ? { commandActions: prev.commandActions } : {}),
      }
    }
    case 'file_change':
    case 'fileChange': {
      const changes = Array.isArray(rec.changes)
        ? rec.changes.map((entry) => {
            const change = asRecord(entry)
            const path = readString(change?.path)
            if (!path) return null
            const diff = readString(change?.diff)
            return { path, kind: mapPatchChangeKind(change?.kind), ...(diff !== null ? { diff } : {}) }
          }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : previous?.type === 'file_change' ? previous.changes : []
      return {
        id,
        type: 'file_change',
        changes,
        status: mapPatchApplyStatus(rec.status ?? (previous?.type === 'file_change' ? previous.status : undefined)),
      }
    }
    case 'mcp_tool_call':
    case 'mcpToolCall': {
      const prev = previous?.type === 'mcp_tool_call' ? previous : null
      const result = asRecord(rec.result)
      const error = asRecord(rec.error)
      return {
        id,
        type: 'mcp_tool_call',
        server: readString(rec.server) ?? prev?.server ?? '',
        tool: readString(rec.tool) ?? prev?.tool ?? '',
        arguments: rec.arguments ?? prev?.arguments ?? {},
        ...(result ? { result: {
          content: Array.isArray(result.content) ? result.content : [],
          structuredContent: result.structuredContent ?? result.structured_content ?? null,
        } } : prev?.result ? { result: prev.result } : {}),
        ...(error ? { error: { message: readString(error.message) ?? 'Unknown MCP tool error' } }
          : prev?.error ? { error: prev.error } : {}),
        status: mapMcpToolCallStatus(rec.status ?? prev?.status),
      }
    }
    case 'web_search':
    case 'webSearch': {
      const prev = previous?.type === 'web_search' ? previous : null
      return {
        id,
        type: 'web_search',
        query: readString(rec.query) ?? prev?.query ?? '',
        status: mapMcpToolCallStatus(rec.status ?? prev?.status),
      }
    }
    case 'image_generation':
    case 'imageGeneration': {
      const prev = previous?.type === 'image_generation' ? previous : null
      const revisedPrompt = readString(rec.revisedPrompt ?? rec.revised_prompt) ?? prev?.revisedPrompt
      const savedPath = readString(rec.savedPath ?? rec.saved_path) ?? prev?.savedPath
      const failure = readCodexImageGenerationFailure(rec.failure) ?? prev?.failure
      return {
        id,
        type: 'image_generation',
        status: readString(rec.status) ?? prev?.status ?? 'in_progress',
        ...(revisedPrompt ? { revisedPrompt } : {}),
        ...(savedPath ? { savedPath } : {}),
        ...(failure ? { failure } : {}),
        ...(prev?.generationMs !== undefined ? { generationMs: prev.generationMs } : {}),
      }
    }
    case 'todo_list':
    case 'todoList': {
      const items = Array.isArray(rec.items)
        ? rec.items.map((entry) => {
            const todo = asRecord(entry)
            const text = readString(todo?.text)
            return text ? { text, completed: readBoolean(todo?.completed) ?? false } : null
          }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : previous?.type === 'todo_list' ? previous.items : []
      return { id, type: 'todo_list', items }
    }
    case 'error':
      return {
        id,
        type: 'error',
        message: readString(rec.message) ?? (previous?.type === 'error' ? previous.message : 'Unknown error'),
      }
    case 'plan': {
      const text = readString(rec.text)
      return text ? buildCodexReasoningItem(id, text, previous, now) : null
    }
    case 'enteredReviewMode':
      return { id, type: 'review', phase: 'entered', text: readString(rec.text) ?? readString(rec.review) ?? '' }
    case 'exitedReviewMode':
      return { id: `${id}_exit`, type: 'review', phase: 'exited', text: readString(rec.text) ?? readString(rec.review) ?? '' }
    case 'contextCompaction':
      return { id, type: 'compaction' }
    case 'collabAgentToolCall':
    case 'collabToolCall': {
      const prev = previous?.type === 'collab_tool_call' ? previous : null
      const receiverThreadIds = uniqueStrings([
        ...readStringArray(rec.receiverThreadIds ?? rec.receiver_thread_ids),
        readString(rec.receiverThreadId ?? rec.receiver_thread_id),
        readString(rec.newThreadId ?? rec.new_thread_id),
      ])
      const agentsStates: Record<string, CodexCollabAgentState> = { ...(prev?.agentsStates ?? {}) }
      const rawStates = asRecord(rec.agentsStates ?? rec.agents_states)
      if (rawStates) {
        for (const [agentId, value] of Object.entries(rawStates)) {
          const state = asRecord(value)
          if (!state) continue
          const prior = prev?.agentsStates?.[agentId]
          agentsStates[agentId] = {
            ...prior,
            status: normalizeCollabAgentStatus(state.status) ?? prior?.status ?? 'running',
            ...(state.message != null ? { message: readString(state.message) ?? undefined } : {}),
          }
        }
      }
      const rawAgentStatus = rec.agentStatus ?? rec.agent_status
      const agentStatus = asRecord(rawAgentStatus)
      if (!rawStates && rawAgentStatus != null) {
        for (const agentId of receiverThreadIds) {
          const prior = prev?.agentsStates?.[agentId]
          agentsStates[agentId] = {
            ...prior,
            status: normalizeCollabAgentStatus(agentStatus?.status ?? rawAgentStatus) ?? prior?.status ?? 'running',
            ...(agentStatus?.message != null ? { message: readString(agentStatus.message) ?? undefined } : {}),
          }
        }
      }
      const rawStatus = readString(rec.status)
      return {
        id,
        type: 'collab_tool_call',
        tool: normalizeCollabTool(rec.tool) ?? prev?.tool ?? 'spawnAgent',
        status: rawStatus === 'completed' ? 'completed' : rawStatus === 'failed' ? 'failed' : 'in_progress',
        ...(readString(rec.senderThreadId) ?? readString(rec.sender_thread_id) ?? prev?.senderThreadId
          ? { senderThreadId: readString(rec.senderThreadId) ?? readString(rec.sender_thread_id) ?? prev?.senderThreadId }
          : {}),
        receiverThreadIds: receiverThreadIds.length > 0 ? receiverThreadIds : (prev?.receiverThreadIds ?? []),
        ...(readString(rec.prompt) ?? prev?.prompt ? { prompt: readString(rec.prompt) ?? prev?.prompt } : {}),
        agentsStates,
        ...(prev?.childItems ? { childItems: prev.childItems } : {}),
      }
    }
    default:
      return null
  }
}

export function mapCodexUsage(raw: unknown): CodexUsageInfo | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const parse = (value: unknown) => {
    const data = asRecord(value)
    if (!data) return null
    return {
      inputTokens: readNumber(data.inputTokens ?? data.input_tokens) ?? 0,
      cachedInputTokens: readNumber(data.cachedInputTokens ?? data.cached_input_tokens) ?? 0,
      cacheWriteInputTokens: readNumber(data.cacheWriteInputTokens ?? data.cache_write_input_tokens) ?? 0,
      outputTokens: readNumber(data.outputTokens ?? data.output_tokens) ?? 0,
      reasoningOutputTokens: readNumber(data.reasoningOutputTokens ?? data.reasoning_output_tokens) ?? 0,
    }
  }
  const last = parse(rec.last)
  const total = parse(rec.total)
  const resolvedLast = last ?? total
  const resolvedTotal = total ?? last
  if (!resolvedLast || !resolvedTotal) return null
  return {
    totalInputTokens: resolvedTotal.inputTokens,
    totalCachedInputTokens: resolvedTotal.cachedInputTokens,
    totalCacheWriteInputTokens: resolvedTotal.cacheWriteInputTokens,
    totalOutputTokens: resolvedTotal.outputTokens,
    lastInputTokens: resolvedLast.inputTokens,
    lastCachedInputTokens: resolvedLast.cachedInputTokens,
    lastCacheWriteInputTokens: resolvedLast.cacheWriteInputTokens,
    lastOutputTokens: resolvedLast.outputTokens,
    reasoningOutputTokens: resolvedTotal.reasoningOutputTokens
      || (readNumber(rec.reasoningOutputTokens ?? rec.reasoning_output_tokens) ?? 0),
    contextWindow: readNumber(rec.modelContextWindow ?? rec.model_context_window ?? rec.contextWindow ?? rec.context_window) ?? 0,
  }
}

function extractError(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Codex turn failed'
  return readString(rec.message) ?? readString(asRecord(rec.error)?.message) ?? 'Codex turn failed'
}

export function deriveCodexFinalResponse(items: CodexThreadItem[]): string {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item?.type === 'agent_message' && item.delivery !== 'async') return item.text
  }
  return ''
}

function emptyApplyResult(): CodexNotificationApplyResult {
  return { textDelta: null, completed: false, error: null, interrupted: false }
}

export function createCodexAgentEventMapper(
  options: CodexAgentEventMapperOptions,
): CodexAgentEventMapper {
  const now = options.now ?? Date.now
  const startedAt = now()
  const order: string[] = []
  const itemMap = new Map<string, CodexThreadItem>()
  const mcpServers = new Map<string, Omit<CodexMcpServerStartup, 'name'>>()
  const retriedErrors: string[] = []
  let currentUsage: CodexUsageInfo | null = null
  let currentThreadId: string | null = null
  let currentTurnId: string | null = options.turnId ?? null
  let lastItemCompletedAt = startedAt
  let started = false
  let terminal = false
  let activeCompaction: { turnId: string | null; startedAt: number; preTokens: number } | null = null
  const completedCompactionTurns = new Set<string>()
  const compactionTrigger: 'manual' | 'auto' = options.turnKind === 'compact' ? 'manual' : 'auto'

  const upsert = (item: CodexThreadItem) => {
    if (!itemMap.has(item.id)) order.push(item.id)
    itemMap.set(item.id, item)
  }
  const items = () => order.map((id) => itemMap.get(id)).filter((item): item is CodexThreadItem => Boolean(item))
  const emitItem = (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => {
    upsert(item)
    options.emit({ type: 'codex_item_delta', messageId: options.messageId, phase, item })
  }
  const finishStatus = () => options.emit({ type: 'status_change', status: 'idle' })
  const startCompaction = (params: Record<string, unknown>) => {
    const turnId = readString(params.turnId) ?? readString(params.turn_id) ?? currentTurnId
    if (turnId && completedCompactionTurns.has(turnId)) return
    if (activeCompaction && (!activeCompaction.turnId || !turnId || activeCompaction.turnId === turnId)) {
      if (!activeCompaction.turnId && turnId) {
        activeCompaction = {
          turnId,
          startedAt: readNumber(params.startedAtMs ?? params.started_at_ms) ?? activeCompaction.startedAt,
          preTokens: currentUsage?.lastInputTokens ?? activeCompaction.preTokens,
        }
      }
      return
    }
    activeCompaction = {
      turnId,
      startedAt: readNumber(params.startedAtMs ?? params.started_at_ms) ?? now(),
      preTokens: currentUsage?.lastInputTokens ?? 0,
    }
    options.emit({ type: 'status_indicator', indicator: 'compacting' })
  }
  const completeCompaction = (params: Record<string, unknown>) => {
    const turnId = readString(params.turnId) ?? readString(params.turn_id) ?? currentTurnId
    if (turnId && completedCompactionTurns.has(turnId)) return
    if (!activeCompaction) startCompaction(params)
    const current = activeCompaction
    if (!current) return
    const completedAt = readNumber(params.completedAtMs ?? params.completed_at_ms) ?? now()
    const postTokens = currentUsage?.lastInputTokens
    options.emit({
      type: 'compact_boundary',
      trigger: compactionTrigger,
      preTokens: current.preTokens,
      ...(postTokens !== undefined && postTokens > 0 ? { postTokens } : {}),
      ...(completedAt >= current.startedAt ? { durationMs: completedAt - current.startedAt } : {}),
      ...(compactionTrigger === 'manual' ? { messageId: options.messageId } : {}),
    })
    options.emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    const completedTurnId = turnId ?? current.turnId
    if (completedTurnId) completedCompactionTurns.add(completedTurnId)
    activeCompaction = null
  }
  const fail = (
    error: string,
    interrupted = false,
    errorOverrides: Omit<Partial<import('@superone/shared/agent-types').AgentErrorInfo>, 'raw'> = {},
  ) => {
    if (terminal) return
    terminal = true
    if (activeCompaction) {
      activeCompaction = null
      options.emit({ type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: error })
    }
    options.emit(interrupted
      ? { type: 'message_interrupted', messageId: options.messageId }
      : {
          type: 'message_error',
          messageId: options.messageId,
          error,
          errorInfo: buildAgentErrorInfo(error, {
            ...(retriedErrors.length > 0 ? { retries: { attempts: retriedErrors.length } } : {}),
            ...errorOverrides,
          }),
        })
    finishStatus()
  }

  return {
    start(threadId) {
      if (started) return
      started = true
      currentThreadId = threadId
      options.emit({
        type: 'message_start',
        message: {
          id: options.messageId,
          role: 'assistant',
          status: 'streaming',
          content: [],
          createdAt: new Date(now()).toISOString(),
          providerId: 'codex',
        },
      })
      options.emit({ type: 'status_change', status: 'streaming' })
      if (threadId) options.emit({ type: 'codex_thread_started', messageId: options.messageId, threadId })
      if (options.turnKind === 'compact') startCompaction({})
    },

    apply(note) {
      const result = emptyApplyResult()
      if (terminal) return result
      const params = note.params
      switch (note.method) {
        case 'thread/started': {
          const threadId = readString(asRecord(params.thread)?.id)
          if (threadId && threadId !== currentThreadId) {
            currentThreadId = threadId
            options.emit({ type: 'codex_thread_started', messageId: options.messageId, threadId })
          }
          break
        }
        case 'item/started':
        case 'item/completed': {
          const raw = asRecord(params.item)
          if (!raw) break
          if (readString(raw.type) === 'contextCompaction') {
            if (note.method === 'item/started') startCompaction(params)
            else completeCompaction(params)
            break
          }
          const previous = readString(raw.id) ? itemMap.get(readString(raw.id)!) : undefined
          if (previous?.type === 'plan' && note.method === 'item/completed') {
            emitItem('completed', previous)
            break
          }
          const mapped = mapCodexThreadItem(raw, previous, now)
          if (mapped) {
            if (
              mapped.type === 'image_generation'
              && note.method === 'item/completed'
              && mapped.generationMs === undefined
            ) {
              mapped.generationMs = now() - lastItemCompletedAt
            }
            emitItem(note.method === 'item/started' ? 'started' : 'completed', mapped)
          }
          if (note.method === 'item/completed') lastItemCompletedAt = now()
          break
        }
        case 'item/agentMessage/delta':
        case 'item/agentMessageDelta': {
          const delta = readCodexDeltaText(params)
          const itemId = readCodexItemId(params)
          if (!itemId) break
          const previous = itemMap.get(itemId)
          if (previous?.type !== 'agent_message' || previous.delivery !== 'async') {
            result.textDelta = delta || null
          }
          emitItem('updated', {
            id: itemId,
            type: 'agent_message',
            text: `${previous?.type === 'agent_message' ? previous.text : ''}${delta}`,
            ...(previous?.type === 'agent_message' && previous.delivery === 'async' ? { delivery: 'async' } : {}),
          })
          break
        }
        case 'autoApprovalReview/strictReviewRequired': {
          const turnId = readString(params.turnId) ?? currentTurnId ?? 'current'
          emitItem('completed', {
            id: `strict_review_${turnId}`,
            type: 'error',
            message: 'Codex requires strict safety review for this turn.',
          })
          break
        }
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/summary_text_delta':
        case 'item/reasoning/summaryDelta':
        case 'item/reasoning/summary_delta':
        case 'item/reasoning/summaryPartAdded':
        case 'item/reasoning/summary_part_added':
        case 'item/reasoning/textDelta':
        case 'item/reasoning/text_delta':
        case 'item/reasoning/delta': {
          const itemId = readCodexItemId(params)
          if (!itemId) break
          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'reasoning' ? previous.text : ''
          const separator = note.method.endsWith('PartAdded') || note.method.endsWith('part_added')
          const text = separator
            ? (previousText && !previousText.endsWith('\n\n') ? `${previousText}\n\n` : previousText)
            : `${previousText}${readCodexDeltaText(params)}`
          emitItem('updated', buildCodexReasoningItem(itemId, text, previous, now))
          break
        }
        case 'item/plan/delta': {
          const itemId = readCodexItemId(params)
          if (!itemId) break
          const previous = itemMap.get(itemId)
          emitItem('updated', {
            id: itemId,
            type: 'plan',
            text: `${previous?.type === 'plan' ? previous.text : ''}${readCodexDeltaText(params)}`,
          })
          break
        }
        case 'item/commandExecution/outputDelta': {
          const itemId = readCodexItemId(params)
          if (!itemId) break
          const previous = itemMap.get(itemId)
          const command = previous?.type === 'command_execution' ? previous : null
          emitItem('updated', {
            id: itemId,
            type: 'command_execution',
            command: command?.command ?? '',
            aggregatedOutput: `${command?.aggregatedOutput ?? ''}${readCodexDeltaText(params)}`,
            ...(command?.exitCode !== undefined ? { exitCode: command.exitCode } : {}),
            status: command?.status ?? 'in_progress',
            ...(command?.commandActions ? { commandActions: command.commandActions } : {}),
          })
          break
        }
        case 'turn/plan/updated': {
          const rawPlan = Array.isArray(params.plan) ? params.plan : []
          const todoItems = rawPlan.map((entry) => {
            const step = asRecord(entry)
            const text = readString(step?.step)
            return text ? { text, completed: readString(step?.status) === 'completed' } : null
          }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          if (todoItems.length > 0) {
            const turnId = readString(params.turnId) ?? readString(params.turn_id) ?? currentTurnId ?? 'current'
            emitItem('updated', { id: `todo_${turnId}`, type: 'todo_list', items: todoItems })
          }
          break
        }
        case 'thread/tokenUsage/updated': {
          const usage = mapCodexUsage(params.tokenUsage ?? params)
          if (usage) {
            currentUsage = usage
            options.emit({
              type: 'message_usage',
              messageId: options.messageId,
              inputTokens: usage.lastInputTokens,
              outputTokens: usage.lastOutputTokens,
              codexUsage: usage,
            })
          }
          break
        }
        case 'thread/compacted': {
          completeCompaction(params)
          break
        }
        case 'mcpServer/startupStatus/updated': {
          const name = readString(params.name)
          if (!name) break
          const rawStatus = readString(params.status)
          const status: CodexMcpServerStartup['status'] = rawStatus === 'ready'
            || rawStatus === 'failed'
            || rawStatus === 'cancelled' ? rawStatus : 'starting'
          const failureReason = readString(params.failureReason) === 'reauthenticationRequired'
            ? 'reauthenticationRequired' as const
            : undefined
          mcpServers.set(name, { status, ...(failureReason ? { failureReason } : {}) })
          options.emit({
            type: 'codex_mcp_startup',
            messageId: options.messageId,
            servers: [...mcpServers].map(([serverName, state]) => ({ name: serverName, ...state })),
          })
          break
        }
        case 'error': {
          if (readBoolean(params.willRetry) === true) {
            // Codex retries in-process and reports no backoff delay, so keep the
            // count only — a give-up can then say how many attempts it burned.
            retriedErrors.push(extractError(params))
            break
          }
          result.error = extractError(params)
          fail(result.error, false, readCodexErrorOverrides(params))
          break
        }
        case 'turn/completed':
        case 'turn/completed/v2': {
          const turn = asRecord(params.turn)
          currentTurnId = readString(turn?.id) ?? currentTurnId
          const status = readString(turn?.status) ?? readString(params.status) ?? 'completed'
          if (status === 'failed' || status === 'error') {
            result.error = extractError(turn?.error ?? params)
            fail(result.error, false, readCodexErrorOverrides(turn?.error ?? params))
            break
          }
          if (status === 'interrupted' || status === 'cancelled') {
            result.error = 'Codex turn interrupted'
            result.interrupted = true
            fail(result.error, true)
            break
          }
          if (activeCompaction) completeCompaction(params)
          for (const id of order) {
            const item = itemMap.get(id)
            if (!item) continue
            if ('status' in item && (item as { status?: string }).status === 'in_progress') {
              const finalStatus = item.type === 'collab_tool_call'
                && item.tool === 'spawnAgent'
                && item.receiverThreadIds.length === 0
                && Object.keys(item.agentsStates).length === 0 ? 'failed' : 'completed'
              emitItem('completed', { ...item, status: finalStatus } as CodexThreadItem)
            } else if (item.type === 'todo_list' && item.items.some((entry) => !entry.completed)) {
              emitItem('completed', { ...item, items: item.items.map((entry) => ({ ...entry, completed: true })) })
            }
          }
          terminal = true
          result.completed = true
          const finalItems = items()
          options.emit({
            type: 'message_complete',
            messageId: options.messageId,
            metadata: {
              codex: {
                finalResponse: deriveCodexFinalResponse(finalItems),
                durationMs: now() - startedAt,
                items: finalItems,
                threadId: currentThreadId,
                ...(currentTurnId ? { turnId: currentTurnId } : {}),
                usage: currentUsage,
                model: options.model,
              },
            },
          })
          finishStatus()
          break
        }
      }
      return result
    },
    fail,
    items,
    usage: () => currentUsage,
  }
}
