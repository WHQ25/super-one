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
   * Subagents owned by a workflow run. Their progress/finish must not share the
   * parent workflow toolUseId (that would mark the workflow complete early).
   */
  workflowOwnedSubagents: Set<string>
  /**
   * Workflow tool_use ids launched with validate_only (authoring smoke-check).
   * Their results must not bind run_id → WorkflowBlock correlation.
   */
  smokeWorkflowToolIds: Set<string>
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
}

export function createXaiCorrelationState(opts?: { cwd?: string }): XaiCorrelationState {
  return {
    ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    workflowToolByRunId: new Map(),
    workflowRevision: new Map(),
    workflowStarted: new Set(),
    workflowOwnedSubagents: new Set(),
    smokeWorkflowToolIds: new Set(),
    pendingToolNamesById: new Map(),
    subagentToolById: new Map(),
    subagentOutputById: new Map(),
    subagentStarted: new Set(),
    bgTaskById: new Map(),
    goalStarted: new Set(),
    lastEventSeq: null,
    lastUsage: null,
    lastMessageId: null,
  }
}

/**
 * Grok child-session transcript path.
 * Layout: ~/.grok/sessions/<urlencode(cwd)>/<child_session_id>/chat_history.jsonl
 * (same as first-party TUI / workflow-transcripts listGrokWorkflowAgents).
 */
export function resolveGrokChildChatHistoryPath(
  cwd: string | undefined | null,
  childSessionId: string | undefined | null,
): string | undefined {
  if (!cwd || !childSessionId) return undefined
  return join(homedir(), '.grok', 'sessions', encodeURIComponent(cwd), childSessionId, 'chat_history.jsonl')
}

/** Resolve + cache Grok subagent output path on correlation state. */
export function noteSubagentOutputFile(
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

function isSubagentLaunchToolName(name: string | undefined): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  return n === 'agent' || n === 'task' || n === 'spawn_subagent' || n === 'spawn_agent'
}

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
 *
 * Returns migration events when a provisional subagent_id key should move onto
 * the launch toolUseId.
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
