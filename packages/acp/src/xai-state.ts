/**
 * Grok agent → client ExtNotification progressive bus.
 *
 * Wire: `x.ai/session_notification` (and aliases) carry `{ sessionId, update: { sessionUpdate, … } }`.
 * Standalone methods (`x.ai/task_backgrounded`, `follow_ups`, …) share the same mappers.
 *
 * @see docs/design/grok-xai-ext-notifications.md
 */
import type { AgentEvent, ContextUsageInfo } from '@superone/shared/agent-types'

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

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function strField(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

export function numField(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

export function boolField(o: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'boolean') return v
  }
  return undefined
}

export function arrField(o: Record<string, unknown>, ...keys: string[]): unknown[] | undefined {
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

export function tryParseJsonObject(text: string): Record<string, unknown> | null {
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
