/**
 * Grok agent → client ExtNotification progressive bus.
 *
 * Wire: `x.ai/session_notification` (and aliases) carry `{ sessionId, update: { sessionUpdate, … } }`.
 * Standalone methods (`x.ai/task_backgrounded`, `follow_ups`, …) share the same mappers.
 *
 * @see docs/design/grok-xai-ext-notifications.md
 */
import type {
  AgentEvent,
  ContextUsageInfo,
  EffortLevel,
} from '@superone/shared/agent-types'
import log from '../logger'

// ── Method names ────────────────────────────────────────────────────────────

export const XAI_SESSION_NOTIFICATION = 'x.ai/session_notification'
export const XAI_SESSION_UPDATE = 'x.ai/session/update'
export const XAI_TASK_BACKGROUNDED = 'x.ai/task_backgrounded'
export const XAI_TASK_COMPLETED = 'x.ai/task_completed'
export const XAI_MONITOR_EVENT = 'x.ai/monitor_event'
export const XAI_FOLLOW_UPS = 'x.ai/follow_ups'
export const XAI_SCHEDULED_TASK_CREATED = 'x.ai/scheduled_task_created'
export const XAI_SCHEDULED_TASK_FIRED = 'x.ai/scheduled_task_fired'
export const XAI_SCHEDULED_TASK_DELETED = 'x.ai/scheduled_task_deleted'

/** Methods registered on the ACP client for progressive work. */
export const XAI_EXT_NOTIFICATION_METHODS = [
  XAI_SESSION_NOTIFICATION,
  XAI_SESSION_UPDATE,
  `_${XAI_SESSION_NOTIFICATION}`,
  `_${XAI_SESSION_UPDATE}`,
  XAI_TASK_BACKGROUNDED,
  XAI_TASK_COMPLETED,
  XAI_MONITOR_EVENT,
  XAI_FOLLOW_UPS,
  XAI_SCHEDULED_TASK_CREATED,
  XAI_SCHEDULED_TASK_FIRED,
  XAI_SCHEDULED_TASK_DELETED,
] as const

// ── Correlation state ───────────────────────────────────────────────────────

export interface BgTaskInfo {
  toolUseId?: string
  description: string
  outputFile?: string
}

export interface XaiCorrelationState {
  /** workflow run_id → launch tool_use_id */
  workflowToolByRunId: Map<string, string>
  /** last applied revision per run_id */
  workflowRevision: Map<string, number>
  /** run_ids that already emitted task_started */
  workflowStarted: Set<string>
  /** subagent_id → spawn tool_use_id */
  subagentToolById: Map<string, string>
  /** subagent_ids that already emitted task_started */
  subagentStarted: Set<string>
  /** task_id → bg task info */
  bgTaskById: Map<string, BgTaskInfo>
  /** goal_ids that already emitted task_started */
  goalStarted: Set<string>
  /** last applied non-workflow eventSeq high-water */
  lastEventSeq: number | null
  /** latest usage snapshot for getContextUsage() */
  lastUsage: ContextUsageInfo | null
  /** last known assistant message id (for message_usage) */
  lastMessageId: string | null
}

export function createXaiCorrelationState(): XaiCorrelationState {
  return {
    workflowToolByRunId: new Map(),
    workflowRevision: new Map(),
    workflowStarted: new Set(),
    subagentToolById: new Map(),
    subagentStarted: new Set(),
    bgTaskById: new Map(),
    goalStarted: new Set(),
    lastEventSeq: null,
    lastUsage: null,
    lastMessageId: null,
  }
}

// ── Field helpers ───────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function strField(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

function numField(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function boolField(o: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'boolean') return v
  }
  return undefined
}

function arrField(o: Record<string, unknown>, ...keys: string[]): unknown[] | undefined {
  for (const k of keys) {
    const v = o[k]
    if (Array.isArray(v)) return v
  }
  return undefined
}

// ── Envelope ────────────────────────────────────────────────────────────────

export interface XaiSessionNotificationEnvelope {
  sessionId?: string
  update: Record<string, unknown>
  meta: Record<string, unknown> | null
  eventSeq: number | null
  eventId: string | null
}

/** Parse `x.ai/session_notification` / `x.ai/session/update` params. */
export function parseXaiSessionNotificationEnvelope(raw: unknown): XaiSessionNotificationEnvelope | null {
  const o = asRecord(raw)
  if (!o) return null
  const update = asRecord(o.update)
  if (!update) return null
  const sessionId = strField(o, 'sessionId', 'session_id')
  const meta = asRecord(o._meta) ?? asRecord(o.meta)
  const eventSeq = meta ? (numField(meta, 'eventSeq', 'event_seq') ?? null) : null
  const eventId = meta ? (strField(meta, 'eventId', 'event_id') ?? null) : null
  return { sessionId, update, meta, eventSeq, eventId }
}

/** Identity params parser for standalone ExtNotifications (pass-through object). */
export function parseXaiExtParams(raw: unknown): Record<string, unknown> {
  return asRecord(raw) ?? {}
}

// ── Correlation from standard tool results ──────────────────────────────────

/**
 * When a workflow / spawn tool completes with JSON containing run_id / subagent_id / task_id,
 * stash the toolUseId so progressive events can attach to the launch chip.
 */
export function noteToolCorrelationFromAgentEvents(
  events: AgentEvent[],
  state: XaiCorrelationState,
): void {
  for (const event of events) {
    if (event.type === 'message_usage') {
      state.lastMessageId = event.messageId
      continue
    }
    if (event.type !== 'content_delta') continue
    const d = event.delta
    if (d.type === 'tool_use') {
      // Remember pending tool ids by name for later result correlation.
      continue
    }
    if (d.type !== 'tool_result' || !d.summary) continue
    const toolUseId = d.toolUseId
    const parsed = tryParseJsonObject(d.summary)
    if (!parsed) continue

    const runId = strField(parsed, 'run_id', 'runId')
    if (runId) {
      state.workflowToolByRunId.set(runId, toolUseId)
    }
    const subagentId =
      strField(parsed, 'subagent_id', 'subagentId')
      ?? strField(parsed, 'agent_id', 'agentId')
      ?? strField(parsed, 'task_id', 'taskId')
    // spawn_subagent results often use task_id / subagent_id
    if (subagentId && (strField(parsed, 'subagent_id', 'subagentId') || strField(parsed, 'subagent_type', 'subagentType'))) {
      state.subagentToolById.set(subagentId, toolUseId)
    } else if (subagentId && strField(parsed, 'agent_id', 'agentId') && !runId) {
      state.subagentToolById.set(subagentId, toolUseId)
    }

    const taskId = strField(parsed, 'task_id', 'taskId')
    if (taskId && !runId) {
      const existing = state.bgTaskById.get(taskId)
      state.bgTaskById.set(taskId, {
        toolUseId: toolUseId ?? existing?.toolUseId,
        description: existing?.description
          ?? strField(parsed, 'description', 'name')
          ?? taskId,
        outputFile: strField(parsed, 'output_file', 'outputFile') ?? existing?.outputFile,
      })
    }
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const v = JSON.parse(trimmed) as unknown
    return asRecord(v)
  } catch {
    // Tool summary may be truncated or prefixed — try first {...} slice.
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return asRecord(JSON.parse(trimmed.slice(start, end + 1)))
    } catch {
      return null
    }
  }
}

// ── Public mappers ──────────────────────────────────────────────────────────

export interface MapXaiNotifyContext {
  /** Active or last prompt message id (for message_usage). */
  messageId?: string | null
}

/**
 * Map a session_notification envelope update → AgentEvents.
 * Mutates correlation state (revisions, started sets, usage cache).
 */
export function mapXaiSessionUpdate(
  update: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext = {},
): AgentEvent[] {
  const kind = strField(update, 'sessionUpdate', 'session_update')
  if (!kind) {
    log.debug('[acp-xai] session update missing sessionUpdate tag')
    return []
  }

  if (ctx.messageId) state.lastMessageId = ctx.messageId

  switch (kind) {
    case 'workflow_updated':
      return mapWorkflowUpdated(update, state)
    case 'subagent_spawned':
      return mapSubagentSpawned(update, state)
    case 'subagent_progress':
      return mapSubagentProgress(update, state)
    case 'subagent_finished':
      return mapSubagentFinished(update, state)
    case 'task_backgrounded':
      return mapTaskBackgrounded(update, state)
    case 'task_completed':
      return mapTaskCompleted(update, state)
    case 'monitor_event':
      return mapMonitorEvent(update, state)
    case 'goal_updated':
      return mapGoalUpdated(update, state)
    case 'scheduled_task_created':
      return mapScheduledTaskCreated(update, state)
    case 'scheduled_task_fired':
      return mapScheduledTaskFired(update, state)
    case 'scheduled_task_deleted':
      return mapScheduledTaskDeleted(update, state)
    case 'turn_completed':
      return mapTurnCompleted(update, state, ctx)
    case 'auto_compact_started':
      return mapAutoCompactStarted(update)
    case 'auto_compact_completed':
      return mapAutoCompactCompleted(update, state, ctx)
    case 'auto_compact_failed':
      return mapAutoCompactFailed(update)
    case 'auto_compact_cancelled':
      return [{ type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: 'cancelled' }]
    case 'model_changed':
      return mapModelChanged(update)
    case 'model_auto_switched':
      return mapModelAutoSwitched(update)
    case 'retry_state':
      return mapRetryState(update)
    case 'auto_recovery_started':
      return mapAutoRecoveryStarted(update)
    case 'auto_recovery_exhausted':
      return mapAutoRecoveryExhausted(update)
    case 'unknown':
      return []
    default:
      log.debug('[acp-xai] ignore unknown sessionUpdate=%s', kind)
      return []
  }
}

/**
 * Map a standalone ExtNotification method (not nested in session_notification).
 */
export function mapXaiStandaloneNotification(
  method: string,
  params: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext = {},
): AgentEvent[] {
  const bare = method.replace(/^_/, '')
  switch (bare) {
    case XAI_SESSION_NOTIFICATION:
    case XAI_SESSION_UPDATE: {
      const env = parseXaiSessionNotificationEnvelope(params)
      if (!env) {
        log.debug('[acp-xai] bad session_notification envelope')
        return []
      }
      // Dedup non-workflow by eventSeq (Grok TUI pattern).
      const kind = strField(env.update, 'sessionUpdate', 'session_update')
      if (kind !== 'workflow_updated' && env.eventSeq != null) {
        if (state.lastEventSeq != null && env.eventSeq <= state.lastEventSeq) {
          log.debug('[acp-xai] drop stale eventSeq=%s last=%s', env.eventSeq, state.lastEventSeq)
          return []
        }
      }
      const events = mapXaiSessionUpdate(env.update, state, ctx)
      if (kind !== 'workflow_updated' && env.eventSeq != null && events.length > 0) {
        state.lastEventSeq = env.eventSeq
      }
      return events
    }
    case XAI_TASK_BACKGROUNDED:
      return mapTaskBackgrounded(params, state)
    case XAI_TASK_COMPLETED:
      return mapTaskCompleted(params, state)
    case XAI_MONITOR_EVENT:
      return mapMonitorEvent(params, state)
    case XAI_FOLLOW_UPS:
      return mapFollowUps(params)
    case XAI_SCHEDULED_TASK_CREATED:
      return mapScheduledTaskCreated(params, state)
    case XAI_SCHEDULED_TASK_FIRED:
      return mapScheduledTaskFired(params, state)
    case XAI_SCHEDULED_TASK_DELETED:
      return mapScheduledTaskDeleted(params, state)
    default:
      log.debug('[acp-xai] ignore standalone method=%s', method)
      return []
  }
}

// ── Workflow ────────────────────────────────────────────────────────────────

const WORKFLOW_TERMINAL = new Set([
  'complete',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'canceled',
  'cleared',
])

function mapWorkflowUpdated(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const runId = strField(u, 'run_id', 'runId')
  if (!runId) return []

  const revision = numField(u, 'revision') ?? 0
  const lastRev = state.workflowRevision.get(runId)
  // revision 0 is a full snapshot — always accept; otherwise require strictly greater.
  if (revision > 0 && lastRev != null && revision <= lastRev) {
    log.debug('[acp-xai] drop stale workflow revision run=%s rev=%s last=%s', runId, revision, lastRev)
    return []
  }
  if (revision > 0 || lastRev == null) {
    state.workflowRevision.set(runId, revision)
  }

  const status = (strField(u, 'status') ?? 'active').toLowerCase()
  if (status === 'cleared') {
    // Already terminal elsewhere, or remove live row — ignore quietly.
    return []
  }

  const name = strField(u, 'name') ?? 'workflow'
  const objective = strField(u, 'objective') ?? ''
  const description = objective ? `${name}: ${objective}` : name
  const toolUseId = state.workflowToolByRunId.get(runId)
  const elapsedMs = numField(u, 'elapsed_ms', 'elapsedMs') ?? 0
  const agentsUsed = numField(u, 'agents_used', 'agentsUsed') ?? 0
  const currentPhase = strField(u, 'current_phase', 'currentPhase')
  const pauseMessage = strField(u, 'pause_message', 'pauseMessage')
  const resultSummary = strField(u, 'result_summary', 'resultSummary')
  const lastEvent = strField(u, 'last_event', 'lastEvent')
  const lastEventDetail = strField(u, 'last_event_detail', 'lastEventDetail')

  const workflowAgents = mapWorkflowAgents(arrField(u, 'agents'))
  const phaseLine = buildWorkflowPhaseSummary(u, currentPhase, pauseMessage, lastEvent, lastEventDetail)
  const usage = {
    totalTokens: sumAgentTokens(workflowAgents),
    toolUses: agentsUsed,
    durationMs: elapsedMs,
  }

  const events: AgentEvent[] = []
  if (!state.workflowStarted.has(runId)) {
    state.workflowStarted.add(runId)
    events.push({
      type: 'task_started',
      taskId: runId,
      ...(toolUseId ? { toolUseId } : {}),
      description,
      taskType: 'workflow',
    })
  }

  if (WORKFLOW_TERMINAL.has(status)) {
    const taskStatus =
      status === 'complete' || status === 'completed' ? 'completed' as const
        : status === 'cancelled' || status === 'canceled' ? 'stopped' as const
          : 'failed' as const
    events.push({
      type: 'task_notification',
      taskId: runId,
      ...(toolUseId ? { toolUseId } : {}),
      taskStatus,
      outputFile: '',
      summary: phaseLine || resultSummary || status,
      usage,
      ...(resultSummary ? { resultText: resultSummary } : {}),
      ...(workflowAgents.length ? { workflowAgents } : {}),
    })
    return events
  }

  events.push({
    type: 'task_progress',
    taskId: runId,
    ...(toolUseId ? { toolUseId } : {}),
    description,
    summary: phaseLine || status,
    usage,
    ...(lastEventDetail || lastEvent ? { activityText: lastEventDetail ?? lastEvent } : {}),
    ...(workflowAgents.length ? { workflowAgents } : {}),
  })
  return events
}

function mapWorkflowAgents(
  raw: unknown[] | undefined,
): Array<{ label: string; toolCount: number; tokens?: number }> {
  if (!raw?.length) return []
  const out: Array<{ label: string; toolCount: number; tokens?: number }> = []
  for (const item of raw) {
    const a = asRecord(item)
    if (!a) continue
    const label = strField(a, 'label') ?? strField(a, 'agent_id', 'agentId') ?? 'agent'
    const tokens = numField(a, 'tokens_used', 'tokensUsed')
    out.push({
      label,
      toolCount: 0,
      ...(tokens != null ? { tokens } : {}),
    })
  }
  return out
}

function sumAgentTokens(agents: Array<{ tokens?: number }>): number {
  return agents.reduce((n, a) => n + (a.tokens ?? 0), 0)
}

function buildWorkflowPhaseSummary(
  u: Record<string, unknown>,
  currentPhase: string | undefined,
  pauseMessage: string | undefined,
  lastEvent: string | undefined,
  lastEventDetail: string | undefined,
): string {
  const phases = arrField(u, 'phases')
  const phaseBits: string[] = []
  if (phases?.length) {
    for (const p of phases) {
      const ph = asRecord(p)
      if (!ph) continue
      const title = strField(ph, 'title') ?? '?'
      const state = strField(ph, 'state') ?? ''
      phaseBits.push(state ? `${title}(${state})` : title)
    }
  }
  const parts: string[] = []
  if (currentPhase) parts.push(`phase: ${currentPhase}`)
  if (phaseBits.length) parts.push(phaseBits.join(' → '))
  if (pauseMessage) parts.push(pauseMessage)
  else if (lastEventDetail) parts.push(lastEventDetail)
  else if (lastEvent) parts.push(lastEvent)
  return parts.join(' · ')
}

// ── Subagent ────────────────────────────────────────────────────────────────

function mapSubagentSpawned(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const id = strField(u, 'subagent_id', 'subagentId')
  if (!id) return []
  if (state.subagentStarted.has(id)) return []
  state.subagentStarted.add(id)

  const description = strField(u, 'description') ?? id
  const subagentType = strField(u, 'subagent_type', 'subagentType')
  const toolUseId = state.subagentToolById.get(id)
  // Also correlate workflow-spawned children under workflow run if present.
  const workflowRunId = strField(u, 'workflow_run_id', 'workflowRunId')
  if (workflowRunId && !toolUseId) {
    const wfTool = state.workflowToolByRunId.get(workflowRunId)
    if (wfTool) state.subagentToolById.set(id, wfTool)
  }

  return [{
    type: 'task_started',
    taskId: id,
    ...(state.subagentToolById.get(id) ? { toolUseId: state.subagentToolById.get(id) } : {}),
    description,
    ...(subagentType ? { taskType: subagentType } : {}),
  }]
}

function mapSubagentProgress(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const id = strField(u, 'subagent_id', 'subagentId')
  if (!id) return []
  const events: AgentEvent[] = []
  if (!state.subagentStarted.has(id)) {
    state.subagentStarted.add(id)
    events.push({
      type: 'task_started',
      taskId: id,
      ...(state.subagentToolById.get(id) ? { toolUseId: state.subagentToolById.get(id)! } : {}),
      description: id,
    })
  }
  const durationMs = numField(u, 'duration_ms', 'durationMs') ?? 0
  const toolCalls = numField(u, 'tool_call_count', 'toolCallCount') ?? 0
  const tokens = numField(u, 'tokens_used', 'tokensUsed') ?? 0
  const toolsUsed = arrField(u, 'tools_used', 'toolsUsed')
  const activityText = toolsUsed?.filter((t): t is string => typeof t === 'string').slice(-5).join(', ')
  const toolUseId = state.subagentToolById.get(id)
  events.push({
    type: 'task_progress',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    description: id,
    usage: { totalTokens: tokens, toolUses: toolCalls, durationMs },
    ...(activityText ? { activityText } : {}),
  })
  // Subagent tokens/window are child-session local — do not overwrite the parent
  // context ring (lastUsage is for the main session / getContextUsage()).
  return events
}

function mapSubagentFinished(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const id = strField(u, 'subagent_id', 'subagentId')
  if (!id) return []
  const status = (strField(u, 'status') ?? 'completed').toLowerCase()
  const taskStatus =
    status === 'completed' || status === 'complete' ? 'completed' as const
      : status === 'cancelled' || status === 'canceled' ? 'stopped' as const
        : 'failed' as const
  const toolUseId = state.subagentToolById.get(id)
  const error = strField(u, 'error')
  const output = strField(u, 'output')
  const durationMs = numField(u, 'duration_ms', 'durationMs') ?? 0
  const toolCalls = numField(u, 'tool_calls', 'toolCalls') ?? 0
  const tokens = numField(u, 'tokens_used', 'tokensUsed') ?? 0

  const events: AgentEvent[] = []
  if (!state.subagentStarted.has(id)) {
    state.subagentStarted.add(id)
    events.push({
      type: 'task_started',
      taskId: id,
      ...(toolUseId ? { toolUseId } : {}),
      description: id,
    })
  }
  events.push({
    type: 'task_notification',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    taskStatus,
    outputFile: '',
    summary: error ?? status,
    usage: { totalTokens: tokens, toolUses: toolCalls, durationMs },
    ...(output ? { resultText: output } : error ? { resultText: error } : {}),
  })
  return events
}

// ── Background tasks / monitor ──────────────────────────────────────────────

function mapTaskBackgrounded(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const taskId = strField(u, 'task_id', 'taskId')
  if (!taskId) return []
  const toolCallId = strField(u, 'tool_call_id', 'toolCallId')
  const command = strField(u, 'command') ?? ''
  const description =
    strField(u, 'monitor_description', 'monitorDescription')
    ?? strField(u, 'description')
    ?? command
    ?? taskId
  const outputFile = strField(u, 'output_file', 'outputFile') ?? ''
  // Dedup dual emission (nested + standalone). Merge fields if a later payload is richer.
  const existing = state.bgTaskById.get(taskId)
  if (existing) {
    state.bgTaskById.set(taskId, {
      toolUseId: toolCallId ?? existing.toolUseId,
      description: description || existing.description,
      outputFile: outputFile || existing.outputFile,
    })
    return []
  }
  state.bgTaskById.set(taskId, {
    toolUseId: toolCallId,
    description,
    outputFile,
  })
  return [{
    type: 'task_started',
    taskId,
    ...(toolCallId ? { toolUseId: toolCallId } : {}),
    description,
    taskType: strField(u, 'monitor_description', 'monitorDescription') ? 'monitor' : 'bash',
  }]
}

function mapTaskCompleted(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  // Nested: { task_snapshot, will_wake }; standalone may flatten snapshot fields.
  const snapshot = asRecord(u.task_snapshot) ?? asRecord(u.taskSnapshot) ?? u
  const taskId = strField(snapshot, 'task_id', 'taskId')
  if (!taskId) return []

  const known = state.bgTaskById.get(taskId)
  const toolUseId = known?.toolUseId ?? strField(snapshot, 'tool_call_id', 'toolCallId')
  const outputFile =
    strField(snapshot, 'output_file', 'outputFile')
    ?? known?.outputFile
    ?? ''
  const description = known?.description
    ?? strField(snapshot, 'description')
    ?? strField(snapshot, 'display_command', 'displayCommand')
    ?? strField(snapshot, 'command')
    ?? taskId
  const completed = boolField(snapshot, 'completed') ?? true
  const exitCode = numField(snapshot, 'exit_code', 'exitCode')
  const explicitlyKilled = boolField(snapshot, 'explicitly_killed', 'explicitlyKilled') ?? false
  const output = strField(snapshot, 'output')

  let taskStatus: 'completed' | 'failed' | 'stopped' = 'completed'
  if (explicitlyKilled) taskStatus = 'stopped'
  else if (!completed) taskStatus = 'failed'
  else if (exitCode != null && exitCode !== 0) taskStatus = 'failed'

  const events: AgentEvent[] = []
  if (!known) {
    events.push({
      type: 'task_started',
      taskId,
      ...(toolUseId ? { toolUseId } : {}),
      description,
    })
  }
  events.push({
    type: 'task_notification',
    taskId,
    ...(toolUseId ? { toolUseId } : {}),
    taskStatus,
    outputFile,
    summary: exitCode != null ? `exit ${exitCode}` : taskStatus,
    ...(output ? { resultText: output.slice(0, 8000) } : {}),
  })
  return events
}

function mapMonitorEvent(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const taskId = strField(u, 'task_id', 'taskId')
  if (!taskId) return []
  const description = strField(u, 'description') ?? state.bgTaskById.get(taskId)?.description ?? taskId
  const eventText = strField(u, 'event_text', 'eventText') ?? ''
  const known = state.bgTaskById.get(taskId)
  if (!known) {
    state.bgTaskById.set(taskId, { description, outputFile: '' })
  }
  const events: AgentEvent[] = []
  if (!known) {
    events.push({
      type: 'task_started',
      taskId,
      description,
      taskType: 'monitor',
    })
  }
  events.push({
    type: 'task_progress',
    taskId,
    ...(known?.toolUseId ? { toolUseId: known.toolUseId } : {}),
    description,
    summary: eventText.slice(0, 500) || 'monitor',
    usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    activityText: eventText.slice(0, 2000),
  })
  return events
}

// ── Goal / scheduler ────────────────────────────────────────────────────────

function mapGoalUpdated(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const goalId = strField(u, 'goal_id', 'goalId')
  if (!goalId) return []
  const objective = strField(u, 'objective') ?? goalId
  const status = (strField(u, 'status') ?? 'active').toLowerCase()
  const phase = strField(u, 'phase') ?? ''
  const tokensUsed = numField(u, 'tokens_used', 'tokensUsed') ?? 0
  const elapsedMs = numField(u, 'elapsed_ms', 'elapsedMs') ?? 0
  const pauseMessage = strField(u, 'pause_message', 'pauseMessage')
  const lastEvent = strField(u, 'last_event', 'lastEvent')
  const liveRole = strField(u, 'current_subagent_role', 'currentSubagentRole')
  const summary = [
    phase && `phase: ${phase}`,
    status,
    liveRole && `agent: ${liveRole}`,
    pauseMessage || lastEvent,
  ].filter(Boolean).join(' · ')

  const events: AgentEvent[] = []
  if (!state.goalStarted.has(goalId)) {
    state.goalStarted.add(goalId)
    events.push({
      type: 'task_started',
      taskId: goalId,
      description: objective,
      taskType: 'goal',
    })
  }

  if (status === 'complete' || status === 'completed' || status === 'cleared') {
    events.push({
      type: 'task_notification',
      taskId: goalId,
      taskStatus: status === 'cleared' ? 'stopped' : 'completed',
      outputFile: '',
      summary,
      usage: { totalTokens: tokensUsed, toolUses: 0, durationMs: elapsedMs },
      resultText: objective,
    })
    return events
  }
  if (status === 'budget_limited') {
    events.push({
      type: 'task_notification',
      taskId: goalId,
      taskStatus: 'failed',
      outputFile: '',
      summary: pauseMessage || summary || 'budget limited',
      usage: { totalTokens: tokensUsed, toolUses: 0, durationMs: elapsedMs },
    })
    return events
  }

  events.push({
    type: 'task_progress',
    taskId: goalId,
    description: objective,
    summary,
    usage: { totalTokens: tokensUsed, toolUses: 0, durationMs: elapsedMs },
    ...(pauseMessage || lastEvent ? { activityText: pauseMessage ?? lastEvent } : {}),
  })
  return events
}

function mapScheduledTaskCreated(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const taskId = strField(u, 'task_id', 'taskId')
  if (!taskId) return []
  const prompt = strField(u, 'prompt') ?? ''
  const schedule = strField(u, 'human_schedule', 'humanSchedule') ?? ''
  const description = schedule ? `Schedule (${schedule}): ${prompt.slice(0, 120)}` : `Schedule: ${prompt.slice(0, 120)}`
  state.bgTaskById.set(taskId, { description, outputFile: '' })
  return [{
    type: 'task_started',
    taskId,
    description,
    taskType: 'scheduled',
  }]
}

function mapScheduledTaskFired(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const taskId = strField(u, 'task_id', 'taskId')
  if (!taskId) return []
  const prompt = strField(u, 'prompt') ?? state.bgTaskById.get(taskId)?.description ?? taskId
  const schedule = strField(u, 'human_schedule', 'humanSchedule') ?? ''
  const known = state.bgTaskById.get(taskId)
  const events: AgentEvent[] = []
  if (!known) {
    events.push({
      type: 'task_started',
      taskId,
      description: prompt,
      taskType: 'scheduled',
    })
  }
  events.push({
    type: 'task_progress',
    taskId,
    description: known?.description ?? prompt,
    summary: schedule ? `fired (${schedule})` : 'fired',
    usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    activityText: prompt.slice(0, 500),
  })
  return events
}

function mapScheduledTaskDeleted(u: Record<string, unknown>, _state: XaiCorrelationState): AgentEvent[] {
  const taskId = strField(u, 'task_id', 'taskId')
  if (!taskId) return []
  return [{
    type: 'task_notification',
    taskId,
    taskStatus: 'stopped',
    outputFile: '',
    summary: 'scheduled task deleted',
  }]
}

// ── Session meta ────────────────────────────────────────────────────────────

/**
 * Apply Grok session/update `_meta.totalTokens` (context occupancy estimate).
 * This is NOT billing usage — it is the live context size for the context ring.
 */
export function noteContextTokensFromMeta(
  state: XaiCorrelationState,
  meta: Record<string, unknown> | null | undefined,
): void {
  if (!meta) return
  const total = numField(meta, 'totalTokens', 'total_tokens')
  if (total == null || total <= 0) return
  const prev = state.lastUsage
  const maxTokens = prev?.maxTokens && prev.maxTokens > 0 ? prev.maxTokens : 0
  state.lastUsage = {
    categories: prev?.categories ?? [],
    totalTokens: total,
    maxTokens,
    percentage: maxTokens > 0
      ? Math.min(100, Math.round((total / maxTokens) * 100))
      : (prev?.percentage ?? 0),
    model: prev?.model ?? '',
  }
}

/** Seed / refresh context window size on the usage cache (does not clear occupancy). */
export function noteContextWindow(state: XaiCorrelationState, maxTokens: number): void {
  if (!(maxTokens > 0)) return
  const prev = state.lastUsage
  const total = prev?.totalTokens ?? 0
  state.lastUsage = {
    categories: prev?.categories ?? [],
    totalTokens: total,
    maxTokens,
    percentage: total > 0
      ? Math.min(100, Math.round((total / maxTokens) * 100))
      : (prev?.percentage ?? 0),
    model: prev?.model ?? '',
  }
}

/** ACP PromptUsage: full input includes cache reads; footer wants uncached only. */
export function uncachedPromptInputTokens(fullInput: number, cachedRead: number): number {
  return Math.max(0, fullInput - cachedRead)
}

function mapTurnCompleted(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const usageRaw = asRecord(u.usage)
  if (!usageRaw) return []

  // ACP PromptUsage identity: inputTokens is FULL (includes cache reads).
  const fullInput = numField(usageRaw, 'inputTokens', 'input_tokens') ?? 0
  const cachedRead = numField(usageRaw, 'cachedReadTokens', 'cached_read_tokens') ?? 0
  const uncachedInput = uncachedPromptInputTokens(fullInput, cachedRead)
  const outputTokens = numField(usageRaw, 'outputTokens', 'output_tokens') ?? 0
  const modelCalls = numField(usageRaw, 'modelCalls', 'model_calls')
  // Billing totalTokens is a sum across model calls — not context occupancy.
  const costTicks = numField(usageRaw, 'costUsdTicks', 'cost_usd_ticks')
  const costUsd = costTicks != null ? costTicks / 1e10 : undefined

  const prev = state.lastUsage
  const maxTokens = prev?.maxTokens && prev.maxTokens > 0 ? prev.maxTokens : 0

  // Context ring: prefer live `_meta.totalTokens` snapshot (lastUsage).
  // Single-call fallback: full prompt size + output ≈ occupancy after the call.
  // Multi-call without meta would double-count if we used billing totals — leave occupancy as-is.
  let contextTokens = prev?.totalTokens && prev.totalTokens > 0 ? prev.totalTokens : 0
  if (contextTokens <= 0 && fullInput > 0 && (modelCalls == null || modelCalls <= 1)) {
    contextTokens = fullInput + outputTokens
  }

  if (contextTokens > 0) {
    state.lastUsage = {
      categories: prev?.categories ?? [],
      totalTokens: contextTokens,
      maxTokens,
      percentage: maxTokens > 0
        ? Math.min(100, Math.round((contextTokens / maxTokens) * 100))
        : (prev?.percentage ?? 0),
      model: prev?.model ?? '',
    }
  }

  const messageId = ctx.messageId ?? state.lastMessageId
  if (!messageId) return []
  return [{
    type: 'message_usage',
    messageId,
    // Footer: this-turn new spend (exclude cache hits).
    inputTokens: uncachedInput,
    outputTokens,
    ...(contextTokens > 0 ? { contextTokens } : {}),
    ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
    ...(costUsd != null ? { costUsd } : {}),
  }]
}

function mapAutoCompactStarted(u: Record<string, unknown>): AgentEvent[] {
  void u
  return [{ type: 'status_indicator', indicator: 'compacting' }]
}

function mapAutoCompactCompleted(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const before = numField(u, 'tokens_before', 'tokensBefore') ?? 0
  const after = numField(u, 'tokens_after', 'tokensAfter')
  const elapsed = numField(u, 'elapsed_ms', 'elapsedMs')
  const events: AgentEvent[] = [
    {
      type: 'status_indicator',
      indicator: null,
      compactResult: 'success',
    },
    {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: before,
      ...(after != null ? { postTokens: after } : {}),
      ...(elapsed != null ? { durationMs: elapsed } : {}),
    },
  ]
  if (after != null && after >= 0) {
    const prev = state.lastUsage
    const maxTokens = prev?.maxTokens && prev.maxTokens > 0 ? prev.maxTokens : 0
    state.lastUsage = {
      categories: prev?.categories ?? [],
      totalTokens: after,
      maxTokens,
      percentage: maxTokens > 0
        ? Math.min(100, Math.round((after / maxTokens) * 100))
        : (prev?.percentage ?? 0),
      model: prev?.model ?? '',
    }
    const messageId = ctx.messageId ?? state.lastMessageId
    if (messageId) {
      events.push({
        type: 'message_usage',
        messageId,
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: after,
        ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
      })
    }
  }
  return events
}

function mapAutoCompactFailed(u: Record<string, unknown>): AgentEvent[] {
  const error = strField(u, 'error') ?? 'auto-compact failed'
  return [{
    type: 'status_indicator',
    indicator: null,
    compactResult: 'failed',
    compactError: error,
  }]
}

function mapModelChanged(u: Record<string, unknown>): AgentEvent[] {
  const modelId = strField(u, 'model_id', 'modelId')
  if (!modelId) return []
  const effort = strField(u, 'reasoning_effort', 'reasoningEffort')
  const selectedEffort = toEffortLevel(effort)
  return [{
    type: 'agent_setting_change',
    selectedModel: modelId,
    ...(selectedEffort !== undefined ? { selectedEffort } : {}),
  }]
}

function mapModelAutoSwitched(u: Record<string, unknown>): AgentEvent[] {
  const newModel = strField(u, 'new_model_id', 'newModelId')
  const prev = strField(u, 'previous_model_id', 'previousModelId')
  const reason = strField(u, 'reason') ?? 'model auto-switched'
  if (!newModel) return []
  return [
    {
      type: 'agent_setting_change',
      selectedModel: newModel,
    },
    {
      type: 'model_fallback',
      trigger: reason,
      ...(prev ? { fromModel: prev } : {}),
      toModel: newModel,
    },
  ]
}

function mapRetryState(u: Record<string, unknown>): AgentEvent[] {
  // Nested: { sessionUpdate, type: "retrying"|"exhausted"|"failed", … } OR { retry_state: { type, … } }
  const nested = asRecord(u.retry_state) ?? asRecord(u.retryState) ?? u
  const type = (strField(nested, 'type') ?? '').toLowerCase()
  if (type === 'retrying') {
    const attempt = numField(nested, 'attempt') ?? 1
    const maxRetries = numField(nested, 'maxRetries', 'max_retries')
    const reason = strField(nested, 'reason')
    return [{
      type: 'api_retry',
      attempt,
      ...(maxRetries != null ? { maxRetries } : {}),
      delayMs: 0,
      ...(reason ? { message: reason } : {}),
    }]
  }
  if (type === 'exhausted') {
    const attempts = numField(nested, 'attempts') ?? 0
    const reason = strField(nested, 'reason')
    const isRateLimited = boolField(nested, 'isRateLimited', 'is_rate_limited')
    if (isRateLimited) {
      return [{
        type: 'rate_limit',
        status: 'rejected',
        rateLimitType: 'api',
      }]
    }
    return [{
      type: 'api_retry',
      attempt: attempts,
      delayMs: 0,
      message: reason ?? 'retries exhausted',
    }]
  }
  if (type === 'failed') {
    const message = strField(nested, 'message') ?? strField(nested, 'error_type', 'errorType') ?? 'error'
    return [{
      type: 'api_retry',
      attempt: 0,
      delayMs: 0,
      message,
    }]
  }
  return []
}

function mapAutoRecoveryStarted(u: Record<string, unknown>): AgentEvent[] {
  const attempt = numField(u, 'attempt') ?? 1
  const maxRetries = numField(u, 'max_retries', 'maxRetries')
  const error = strField(u, 'error')
  const delayMs = numField(u, 'delay_ms', 'delayMs') ?? 0
  return [{
    type: 'api_retry',
    attempt,
    ...(maxRetries != null ? { maxRetries } : {}),
    delayMs,
    ...(error ? { message: error } : { message: 'auto-recovery' }),
  }]
}

function mapAutoRecoveryExhausted(u: Record<string, unknown>): AgentEvent[] {
  const attempts = numField(u, 'attempts') ?? 0
  const error = strField(u, 'error')
  return [{
    type: 'api_retry',
    attempt: attempts,
    delayMs: 0,
    message: error ?? 'auto-recovery exhausted',
  }]
}

function mapFollowUps(u: Record<string, unknown>): AgentEvent[] {
  // snake_case wire: { response_id, suggestions: [{ label }] }
  const meta = asRecord(u._meta) ?? asRecord(u.meta)
  if (meta && meta['x.ai/replayed'] === true) return []

  const responseId = strField(u, 'response_id', 'responseId')
  if (!responseId || responseId.length > 128) return []

  const suggestions = arrField(u, 'suggestions') ?? []
  const events: AgentEvent[] = []
  let count = 0
  for (const s of suggestions) {
    if (count >= 6) break
    const rec = asRecord(s)
    const label = (rec ? strField(rec, 'label') : typeof s === 'string' ? s : undefined)?.trim()
    if (!label) continue
    // Strip control chars lightly
    const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256).trim()
    if (!cleaned) continue
    events.push({ type: 'prompt_suggestion', suggestion: cleaned })
    count += 1
  }
  return events
}

function toEffortLevel(v: string | undefined): EffortLevel | undefined {
  if (!v) return undefined
  const lower = v.toLowerCase()
  if (lower === 'low' || lower === 'medium' || lower === 'high' || lower === 'xhigh' || lower === 'max') {
    return lower
  }
  return undefined
}
