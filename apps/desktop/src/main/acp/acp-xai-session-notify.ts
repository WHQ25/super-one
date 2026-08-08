/**
 * Grok agent → client ExtNotification progressive bus.
 *
 * Wire: `x.ai/session_notification` (and aliases) carry `{ sessionId, update: { sessionUpdate, … } }`.
 * Standalone methods (`x.ai/task_backgrounded`, `follow_ups`, …) share the same mappers.
 *
 * @see docs/design/grok-xai-ext-notifications.md
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  /**
   * Parent session cwd (ACP launch cwd). Used to resolve Grok child-session
   * transcripts at ~/.grok/sessions/<urlencode(cwd)>/<child_id>/chat_history.jsonl.
   */
  cwd?: string
  /** workflow run_id → launch tool_use_id */
  workflowToolByRunId: Map<string, string>
  /** last applied revision per run_id */
  workflowRevision: Map<string, number>
  /** run_ids that already emitted task_started */
  workflowStarted: Set<string>
  /**
   * Workflow tool_use ids launched with validate_only (authoring smoke-check).
   * Their results must not bind run_id → WorkflowBlock correlation.
   */
  smokeWorkflowToolIds: Set<string>
  /**
   * Subagents owned by a workflow run. Their progress/finish must not share the
   * parent workflow toolUseId (that would mark the workflow complete early).
   */
  workflowOwnedSubagents: Set<string>
  /** tool_use_id → toolName (for gating plain-text spawn ack correlation) */
  pendingToolNamesById: Map<string, string>
  /** subagent_id → spawn tool_use_id */
  subagentToolById: Map<string, string>
  /** subagent_id → child chat_history.jsonl path (once resolved) */
  subagentOutputById: Map<string, string>
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
  /**
   * Whether the last turn terminal was `rate_limit`. Scopes the gauge tip to one
   * rate-limit episode: only a served turn clears it (Grok sends no "you're fine
   * again" signal).
   */
  rateLimited: boolean
}

export function createXaiCorrelationState(opts?: { cwd?: string }): XaiCorrelationState {
  return {
    ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    workflowToolByRunId: new Map(),
    workflowRevision: new Map(),
    workflowStarted: new Set(),
    smokeWorkflowToolIds: new Set(),
    workflowOwnedSubagents: new Set(),
    pendingToolNamesById: new Map(),
    subagentToolById: new Map(),
    subagentOutputById: new Map(),
    subagentStarted: new Set(),
    bgTaskById: new Map(),
    goalStarted: new Set(),
    lastEventSeq: null,
    lastUsage: null,
    lastMessageId: null,
    rateLimited: false,
  }
}

/** Grok child-session transcript: ~/.grok/sessions/<urlencode(cwd)>/<child_id>/chat_history.jsonl */
export function resolveGrokChildChatHistoryPath(
  cwd: string | undefined | null,
  childSessionId: string | undefined | null,
): string | undefined {
  if (!cwd || !childSessionId) return undefined
  return join(homedir(), '.grok', 'sessions', encodeURIComponent(cwd), childSessionId, 'chat_history.jsonl')
}

function noteSubagentOutputFile(
  state: XaiCorrelationState,
  subagentId: string,
  childSessionId?: string | null,
): string | undefined {
  const existing = state.subagentOutputById.get(subagentId)
  if (existing) return existing
  const path = resolveGrokChildChatHistoryPath(state.cwd, childSessionId || subagentId)
  if (path) state.subagentOutputById.set(subagentId, path)
  return path
}

/** Normalized tool names that launch a SubagentBlock (Claude Agent / Grok spawn). */
function isSubagentLaunchToolName(name: string | undefined): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  return n === 'agent' || n === 'task' || n === 'spawn_subagent' || n === 'spawn_agent'
}

/**
 * Bind subagent_id → launch toolUseId. First binder wins (no rebind from later
 * tools that echo the id). When the subagent already started under a provisional
 * taskId key, emit a migration task_progress so the reducer moves to toolUseId.
 */
function bindSubagentToolId(
  state: XaiCorrelationState,
  subagentId: string,
  toolUseId: string,
  description: string | undefined,
  migrateOut: AgentEvent[],
): void {
  if (state.workflowOwnedSubagents.has(subagentId)) return
  const existing = state.subagentToolById.get(subagentId)
  if (existing && existing !== toolUseId) return
  const isNew = !existing
  if (isNew) state.subagentToolById.set(subagentId, toolUseId)
  if (isNew && state.subagentStarted.has(subagentId)) {
    migrateOut.push({
      type: 'task_progress',
      taskId: subagentId,
      toolUseId,
      description: description ?? subagentId,
      usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    })
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
 * Parse Grok plain-text spawn / bg-task acks, e.g.:
 *   Subagent started in background.
 *   subagent_id: 019fdacb-…
 *   type: general-purpose
 *   Use get_command_or_subagent_output with task_ids=["…"] …
 */
export function parsePlainTextTaskAck(text: string): {
  subagentId?: string
  taskId?: string
  outputFile?: string
  description?: string
  subagentType?: string
} {
  const subagentId =
    text.match(/subagent_id:\s*(\S+)/i)?.[1]
    ?? text.match(/task_ids?\s*=\s*\[\s*"([^"]+)"/i)?.[1]
  const taskId =
    text.match(/(?:^|\n)\s*task_id:\s*(\S+)/i)?.[1]
    ?? subagentId
  const outputFile = text.match(/output_file:\s*(\S+)/i)?.[1]
  const description = text.match(/(?:^|\n)\s*description:\s*(.+)$/im)?.[1]?.trim()
  const subagentType =
    text.match(/(?:^|\n)\s*(?:type|subagent_type):\s*(\S+)/i)?.[1]
  return {
    ...(subagentId ? { subagentId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(outputFile ? { outputFile } : {}),
    ...(description ? { description } : {}),
    ...(subagentType ? { subagentType } : {}),
  }
}

/**
 * When a workflow / spawn tool completes with JSON (or Grok plain-text ack)
 * containing run_id / subagent_id / task_id, stash the toolUseId so progressive
 * events can attach to the launch chip (SubagentBlock / WorkflowBlock).
 */
/**
 * Returns migration events when a provisional subagent_id key should move onto
 * the launch toolUseId (deliver these after the standard tool deltas).
 */
export function noteToolCorrelationFromAgentEvents(
  events: AgentEvent[],
  state: XaiCorrelationState,
): AgentEvent[] {
  const migrate: AgentEvent[] = []
  for (const event of events) {
    if (event.type === 'message_usage') {
      state.lastMessageId = event.messageId
      continue
    }
    if (event.type !== 'content_delta') continue
    const d = event.delta
    if (d.type === 'tool_use') {
      if (d.toolUseId && d.toolName) {
        state.pendingToolNamesById.set(d.toolUseId, d.toolName)
      }
      // Remember authoring smoke-checks so tool_result run_id is not bound to WorkflowBlock.
      const toolName = (d.toolName ?? '').toLowerCase()
      if (
        (toolName === 'workflow' || toolName === 'run_workflow')
        && d.toolUseId
        && isValidateOnlyToolInput(d.input)
      ) {
        state.smokeWorkflowToolIds.add(d.toolUseId)
      }
      continue
    }
    if (d.type !== 'tool_result' || !d.summary) continue
    const toolUseId = d.toolUseId
    const launchName = state.pendingToolNamesById.get(toolUseId)
    const isSpawnLaunch = isSubagentLaunchToolName(launchName)
    const parsed = tryParseJsonObject(d.summary)
    if (parsed) {
      const runId = strField(parsed, 'run_id', 'runId')
      if (runId && toolUseId && !state.smokeWorkflowToolIds.has(toolUseId)) {
        state.workflowToolByRunId.set(runId, toolUseId)
      }
      const explicitSubagentId = strField(parsed, 'subagent_id', 'subagentId')
      const agentId = strField(parsed, 'agent_id', 'agentId')
      const hasSubagentShape = !!(
        explicitSubagentId
        || strField(parsed, 'subagent_type', 'subagentType')
        || (agentId && !runId)
      )
      const subagentId =
        explicitSubagentId
        ?? agentId
        ?? strField(parsed, 'task_id', 'taskId')
      // spawn_subagent results often use task_id / subagent_id
      if (subagentId && (explicitSubagentId || strField(parsed, 'subagent_type', 'subagentType'))) {
        if (isSpawnLaunch || !launchName) {
          bindSubagentToolId(state, subagentId, toolUseId, strField(parsed, 'description', 'name'), migrate)
        }
      } else if (subagentId && agentId && !runId) {
        if (isSpawnLaunch || !launchName) {
          bindSubagentToolId(state, subagentId, toolUseId, strField(parsed, 'description', 'name'), migrate)
        }
      }

      // Pure bg-task map only — do not dual-write spawn chips into bgTaskById
      // (progressive subagent_* events already bind via subagentToolById).
      const taskId = strField(parsed, 'task_id', 'taskId')
      if (taskId && !runId && !hasSubagentShape) {
        const existing = state.bgTaskById.get(taskId)
        if (!existing?.toolUseId || existing.toolUseId === toolUseId) {
          state.bgTaskById.set(taskId, {
            toolUseId: toolUseId ?? existing?.toolUseId,
            description: existing?.description
              ?? strField(parsed, 'description', 'name')
              ?? taskId,
            outputFile: strField(parsed, 'output_file', 'outputFile') ?? existing?.outputFile,
          })
        }
      }
      continue
    }

    // Grok spawn_subagent / bg task often returns a human-readable ack, not JSON.
    // Gate: only Agent/Task launches, or a clear "started in background" spawn ack.
    // Never rebind an already-mapped subagent_id from a later tool that echoes the id.
    const plain = parsePlainTextTaskAck(d.summary)
    const allowPlain =
      isSpawnLaunch
      || /started in background/i.test(d.summary)
    if (allowPlain && plain.subagentId) {
      bindSubagentToolId(state, plain.subagentId, toolUseId, plain.description, migrate)
    }
    // Only map bgTaskById for true bg-task shapes: explicit task_id distinct from
    // subagent_id, and/or an output_file. Pure spawn acks (subagent_id only, with
    // taskId falling back to subagentId) must not dual-write.
    const explicitTaskId = d.summary.match(/(?:^|\n)\s*task_id:\s*(\S+)/i)?.[1]
    const bgTaskId =
      plain.outputFile
        ? (explicitTaskId ?? plain.taskId)
        : explicitTaskId && explicitTaskId !== plain.subagentId
          ? explicitTaskId
          : explicitTaskId && !plain.subagentId
            ? explicitTaskId
            : undefined
    if (allowPlain && bgTaskId) {
      const existing = state.bgTaskById.get(bgTaskId)
      if (!existing?.toolUseId || existing.toolUseId === toolUseId) {
        state.bgTaskById.set(bgTaskId, {
          toolUseId: toolUseId ?? existing?.toolUseId,
          description: plain.description ?? existing?.description ?? bgTaskId,
          outputFile: plain.outputFile ?? existing?.outputFile,
        })
      }
    }
  }
  return migrate
}

/** True when a workflow tool_use input is authoring smoke-check (validate_only). */
export function isValidateOnlyToolInput(input: string | undefined | null): boolean {
  if (!input) return false
  try {
    const o = tryParseJsonObject(input)
    if (o) return o.validate_only === true || o.validateOnly === true
  } catch {
    // fall through
  }
  return /"validate_only"\s*:\s*true/.test(input) || /"validateOnly"\s*:\s*true/.test(input)
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
    case 'last_turn_summary':
      return mapLastTurnSummary(update, ctx)
    case 'session_recap':
      return mapSessionRecap(update)
    case 'session_recap_unavailable':
      // Manual /recap spinner clear only — SuperOne has no spinner for this.
      return []
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
  const workflowPhases = mapWorkflowPhases(arrField(u, 'phases'))
  const phaseLine = buildWorkflowPhaseSummary(u, currentPhase, pauseMessage, lastEvent, lastEventDetail)
  const usage = {
    totalTokens: sumAgentTokens(workflowAgents),
    toolUses: agentsUsed,
    durationMs: elapsedMs,
  }
  const phaseFields = {
    ...(workflowPhases.length ? { workflowPhases } : {}),
    ...(currentPhase ? { currentPhase } : {}),
    ...(workflowAgents.length ? { workflowAgents } : {}),
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
      ...phaseFields,
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
    ...phaseFields,
  })
  return events
}

function mapWorkflowPhases(
  raw: unknown[] | undefined,
): Array<{ title: string; state?: string }> {
  if (!raw?.length) return []
  const out: Array<{ title: string; state?: string }> = []
  for (const item of raw) {
    const p = asRecord(item)
    if (!p) continue
    const title = strField(p, 'title')
    if (!title) continue
    const state = strField(p, 'state')
    out.push({ title, ...(state ? { state } : {}) })
  }
  return out
}

function mapWorkflowAgents(
  raw: unknown[] | undefined,
): Array<{ agentId?: string; label: string; toolCount: number; tokens?: number; state?: string; phase?: string }> {
  if (!raw?.length) return []
  const out: Array<{ agentId?: string; label: string; toolCount: number; tokens?: number; state?: string; phase?: string }> = []
  for (const item of raw) {
    const a = asRecord(item)
    if (!a) continue
    const agentId = strField(a, 'agent_id', 'agentId')
    const label = strField(a, 'label') ?? agentId ?? 'agent'
    const tokens = numField(a, 'tokens_used', 'tokensUsed')
    const agentState = strField(a, 'state')
    const phase = strField(a, 'phase')
    out.push({
      label,
      toolCount: 0,
      ...(agentId ? { agentId } : {}),
      ...(tokens != null ? { tokens } : {}),
      ...(agentState ? { state: agentState } : {}),
      ...(phase ? { phase } : {}),
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
  // Workflow-spawned children must NOT share the workflow toolUseId. Doing so
  // makes the first child's task_notification mark the whole workflow complete.
  // Their lifecycle is already mirrored on workflow_updated.agents rows.
  const workflowRunId = strField(u, 'workflow_run_id', 'workflowRunId')
  if (workflowRunId) {
    state.workflowOwnedSubagents.add(id)
    state.subagentToolById.delete(id)
  }
  const toolUseId = workflowRunId ? undefined : state.subagentToolById.get(id)
  const childSessionId = strField(u, 'child_session_id', 'childSessionId') ?? id
  const outputFile = workflowRunId ? undefined : noteSubagentOutputFile(state, id, childSessionId)

  return [{
    type: 'task_started',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    description,
    ...(subagentType ? { taskType: subagentType } : {}),
    ...(outputFile ? { outputFile } : {}),
  }]
}

function mapSubagentProgress(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const id = strField(u, 'subagent_id', 'subagentId')
  if (!id) return []
  // Workflow-owned children: workflow_updated already carries agent rows + tokens.
  if (state.workflowOwnedSubagents.has(id)) return []
  const childSessionId = strField(u, 'child_session_id', 'childSessionId') ?? id
  const outputFile = noteSubagentOutputFile(state, id, childSessionId)
  const events: AgentEvent[] = []
  if (!state.subagentStarted.has(id)) {
    state.subagentStarted.add(id)
    events.push({
      type: 'task_started',
      taskId: id,
      ...(state.subagentToolById.get(id) ? { toolUseId: state.subagentToolById.get(id)! } : {}),
      description: id,
      ...(outputFile ? { outputFile } : {}),
    })
  }
  const durationMs = numField(u, 'duration_ms', 'durationMs') ?? 0
  const toolCalls = numField(u, 'tool_call_count', 'toolCallCount') ?? 0
  const tokens = numField(u, 'tokens_used', 'tokensUsed') ?? 0
  // tools_used is a *distinct name set* — set order is not call order, so do
  // NOT derive lastToolName / active tool from it. Live rows come from
  // chat_history.jsonl (outputFile).
  const toolsUsed = (arrField(u, 'tools_used', 'toolsUsed') ?? [])
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  const activityText = toolsUsed.length ? toolsUsed.join(', ') : undefined
  const toolUseId = state.subagentToolById.get(id)
  events.push({
    type: 'task_progress',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    description: id,
    usage: { totalTokens: tokens, toolUses: toolCalls, durationMs },
    ...(activityText ? { activityText } : {}),
    ...(outputFile ? { outputFile } : {}),
  })
  // Subagent tokens/window are child-session local — do not overwrite the parent
  // context ring (lastUsage is for the main session / getContextUsage()).
  return events
}

function mapSubagentFinished(u: Record<string, unknown>, state: XaiCorrelationState): AgentEvent[] {
  const id = strField(u, 'subagent_id', 'subagentId')
  if (!id) return []
  // Same as progress: workflow children finish is reflected by workflow_updated.
  if (state.workflowOwnedSubagents.has(id)) return []
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
  const childSessionId = strField(u, 'child_session_id', 'childSessionId') ?? id
  const outputFile = noteSubagentOutputFile(state, id, childSessionId) ?? ''

  const events: AgentEvent[] = []
  if (!state.subagentStarted.has(id)) {
    state.subagentStarted.add(id)
    events.push({
      type: 'task_started',
      taskId: id,
      ...(toolUseId ? { toolUseId } : {}),
      description: id,
      ...(outputFile ? { outputFile } : {}),
    })
  }
  events.push({
    type: 'task_notification',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    taskStatus,
    outputFile,
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
  const events: AgentEvent[] = mapTurnStopReason(u, state)
  const usageRaw = asRecord(u.usage)
  if (!usageRaw) return events

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
  if (!messageId) return events
  events.push({
    type: 'message_usage',
    messageId,
    // Footer: this-turn new spend (exclude cache hits).
    inputTokens: uncachedInput,
    outputTokens,
    ...(contextTokens > 0 ? { contextTokens } : {}),
    ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
    ...(costUsd != null ? { costUsd } : {}),
  })
  return events
}

/**
 * Quota state carried by the turn terminal. Grok reports an exhausted quota as
 * `stop_reason: "rate_limit"` on this durable rail (the prose lives in the
 * `session/prompt` RPC error), so it is the only place the usage gauge can learn
 * about it. Re-emitted on every rejected turn — a retry that fails again is
 * worth flagging — while the clear fires once, on the next served turn.
 */
function mapTurnStopReason(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
): AgentEvent[] {
  const stopReason = strField(u, 'stopReason', 'stop_reason')
  if (stopReason === 'rate_limit') {
    state.rateLimited = true
    return [{ type: 'rate_limit', status: 'rejected', rateLimitType: 'api' }]
  }
  // Only `end_turn` proves the API served us; `cancelled` says nothing about quota.
  if (stopReason === 'end_turn' && state.rateLimited) {
    state.rateLimited = false
    return [{ type: 'rate_limit', status: 'allowed' }]
  }
  return []
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

/** Grok `last_turn_summary` — one-line dashboard fragment after a successful turn. */
function mapLastTurnSummary(
  u: Record<string, unknown>,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const summary = strField(u, 'summary')?.trim()
  if (!summary) return []
  const promptId = strField(u, 'prompt_id', 'promptId')
  return [{
    type: 'turn_summary',
    summary,
    ...(promptId ? { promptId } : {}),
    ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
  }]
}

/** Grok `session_recap` — one-sentence return-from-idle / `/recap` body. */
function mapSessionRecap(u: Record<string, unknown>): AgentEvent[] {
  const summary = strField(u, 'summary')?.trim()
  if (!summary) return []
  const auto = boolField(u, 'auto')
  return [{
    type: 'session_recap',
    summary,
    ...(auto != null ? { auto } : {}),
  }]
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
