import type { AgentEvent, EffortLevel } from '@superone/shared/agent-types'
import {
  XAI_FOLLOW_UPS,
  XAI_MONITOR_EVENT,
  XAI_SCHEDULED_TASK_CREATED,
  XAI_SCHEDULED_TASK_DELETED,
  XAI_SCHEDULED_TASK_FIRED,
  XAI_SESSION_NOTIFICATION,
  XAI_SESSION_UPDATE,
  XAI_TASK_BACKGROUNDED,
  XAI_TASK_COMPLETED,
  arrField,
  asRecord,
  boolField,
  noteSubagentOutputFile,
  numField,
  parseXaiSessionNotificationEnvelope,
  resetTurnTokens,
  str,
  strField,
  type XaiCorrelationState,
} from './xai-state'

const log = { debug: (..._args: unknown[]) => undefined }

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
    case 'response_started':
      return mapResponseStarted(update, state, ctx)
    case 'response_completed':
      return mapResponseCompleted(update, state, ctx)
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
      return [{ type: 'session_recap_unavailable' }]
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
    // Prefer the structured result for both the chip summary and the output panel.
    // pause_message carries failure / cancel detail when result_summary is absent.
    const resultText = resultSummary || pauseMessage || lastEventDetail || undefined
    events.push({
      type: 'task_notification',
      taskId: runId,
      ...(toolUseId ? { toolUseId } : {}),
      taskStatus,
      outputFile: '',
      summary: resultSummary || phaseLine || pauseMessage || status,
      usage,
      ...(resultText ? { resultText } : {}),
      ...phaseFields,
    })
    return events
  }

  // Non-terminal (active / paused / budget_limited / blocked / …) — never complete.
  events.push({
    type: 'task_progress',
    taskId: runId,
    ...(toolUseId ? { toolUseId } : {}),
    description,
    summary: phaseLine || pauseMessage || status,
    usage,
    ...(lastEventDetail || lastEvent || pauseMessage
      ? { activityText: pauseMessage ?? lastEventDetail ?? lastEvent }
      : {}),
    ...phaseFields,
  })
  return events
}

function mapWorkflowPhases(
  raw: unknown[] | undefined,
): Array<{ title: string; detail?: string; state?: string }> {
  if (!raw?.length) return []
  const out: Array<{ title: string; detail?: string; state?: string }> = []
  for (const item of raw) {
    const p = asRecord(item)
    if (!p) continue
    const title = strField(p, 'title')
    if (!title) continue
    const detail = strField(p, 'detail')
    const state = strField(p, 'state')
    out.push({
      title,
      ...(detail ? { detail } : {}),
      ...(state ? { state } : {}),
    })
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
  // Emitting task_progress under a shared toolUseId used to flip the parent complete.
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
  // tools_used is a *distinct name set* (signals.rs) — set order is not call
  // order, so do NOT derive lastToolName / active tool from it. Live rows and
  // last-tool chrome come from child chat_history.jsonl (outputFile).
  const toolsUsed = (arrField(u, 'tools_used', 'toolsUsed') ?? [])
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  const activityText = toolsUsed.length ? toolsUsed.join(', ') : undefined
  const toolUseId = state.subagentToolById.get(id)
  events.push({
    type: 'task_progress',
    taskId: id,
    ...(toolUseId ? { toolUseId } : {}),
    // Keep a stable non-tool description so reducer does not invent history from
    // description transitions when no transcript path is available.
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

/**
 * Build footer `message_usage` from mid-turn accumulators + live context cache.
 * Input/output of 0 still emit when cache-only or provisional — caller decides.
 */
function messageUsageFromTurnTokens(
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
  tokens: { input: number; output: number; cacheRead: number },
): AgentEvent | null {
  const messageId = ctx.messageId ?? state.lastMessageId
  if (!messageId) return null
  if (tokens.input <= 0 && tokens.output <= 0 && tokens.cacheRead <= 0) return null
  const prev = state.lastUsage
  const contextTokens = prev?.totalTokens && prev.totalTokens > 0 ? prev.totalTokens : 0
  const maxTokens = prev?.maxTokens && prev.maxTokens > 0 ? prev.maxTokens : 0
  return {
    type: 'message_usage',
    messageId,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    ...(tokens.cacheRead > 0 ? { cacheReadTokens: tokens.cacheRead } : {}),
    ...(contextTokens > 0 ? { contextTokens } : {}),
    ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
  }
}

/**
 * Grok `response_started` (Messages backend): early input-side counts for the
 * open model call. Provisional — not yet committed to turnTokens (completed
 * owns the commit so we never double-count).
 */
function mapResponseStarted(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const input = numField(u, 'inputTokens', 'input_tokens') ?? 0
  const cacheRead = numField(u, 'cacheReadInputTokens', 'cache_read_input_tokens') ?? 0
  // Provisional: prior committed calls + this call's early input.
  const provisional = {
    input: state.turnTokens.input + input,
    output: state.turnTokens.output,
    cacheRead: state.turnTokens.cacheRead + cacheRead,
  }
  const event = messageUsageFromTurnTokens(state, ctx, provisional)
  return event ? [event] : []
}

/**
 * Grok `response_completed`: one model call finished. Accumulate and emit so
 * the footer updates mid-turn (Claude/Codex parity for multi-step loops).
 */
function mapResponseCompleted(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const usageRaw = asRecord(u.usage) ?? u
  // ResponseUsage: input_tokens is uncached prompt portion for THIS call.
  const input = numField(usageRaw, 'inputTokens', 'input_tokens') ?? 0
  const output = numField(usageRaw, 'outputTokens', 'output_tokens') ?? 0
  const cacheRead = numField(usageRaw, 'cacheReadInputTokens', 'cache_read_input_tokens') ?? 0
  if (input <= 0 && output <= 0 && cacheRead <= 0) return []

  state.turnTokens = {
    input: state.turnTokens.input + input,
    output: state.turnTokens.output + output,
    cacheRead: state.turnTokens.cacheRead + cacheRead,
  }
  const event = messageUsageFromTurnTokens(state, ctx, state.turnTokens)
  return event ? [event] : []
}

function mapTurnCompleted(
  u: Record<string, unknown>,
  state: XaiCorrelationState,
  ctx: MapXaiNotifyContext,
): AgentEvent[] {
  const events: AgentEvent[] = mapTurnStopReason(u, state)
  const usageRaw = asRecord(u.usage)
  if (!usageRaw) {
    resetTurnTokens(state)
    return events
  }

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

  // Authoritative turn totals — keep accumulators aligned then clear for next turn.
  state.turnTokens = {
    input: uncachedInput,
    output: outputTokens,
    cacheRead: cachedRead,
  }

  const messageId = ctx.messageId ?? state.lastMessageId
  if (messageId) {
    events.push({
      type: 'message_usage',
      messageId,
      // Footer: this-turn new spend (exclude cache hits).
      inputTokens: uncachedInput,
      outputTokens,
      ...(cachedRead > 0 ? { cacheReadTokens: cachedRead } : {}),
      ...(contextTokens > 0 ? { contextTokens } : {}),
      ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
      ...(costUsd != null ? { costUsd } : {}),
    })
  }
  resetTurnTokens(state)
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

function mapAutoCompactFailed(u: Record<string, unknown>): AgentEvent[] {
  const error = strField(u, 'error') ?? 'auto-compact failed'
  return [{
    type: 'status_indicator',
    indicator: null,
    compactResult: 'failed',
    compactError: error,
  }]
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
