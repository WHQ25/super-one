/**
 * SuperOne MCP automation tools:
 * automation_list / automation_apply / automation_delete
 *
 * Current project only. Create / update / delete all require user confirmation
 * via HostConfirmRegistry before mutating.
 */

import { encode as toonEncode } from '@toon-format/toon'
import type {
  AgentRunConfig,
  Automation,
  AutomationConfirmAgentView,
  AutomationConfirmChange,
  AutomationConfirmItem,
  AutomationConfirmPayload,
  AutomationSchedule,
  ClaudeRunConfig,
  CodexRunConfig,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@superone/shared/agent-types'
import {
  computeNextRunAt,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationsForProject,
  updateAutomation,
} from '../db-automations'
import { notifyAutomationsListChanged } from '../automation-service'
import log from '../logger'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import type { BuiltInSuperoneToolDeps, SessionTitleSetter } from './superone-mcp-builtins'

export const AUTOMATION_LIST_DEFAULT_LIMIT = 50
export const AUTOMATION_LIST_MAX_LIMIT = 100
export const AUTOMATION_DELETE_MAX = 20
export const AUTOMATION_PROMPT_PREVIEW = 80

const CONFIRM_TIMEOUT_MS = 10 * 60_000

type ConfirmOutcome = {
  action: 'accept' | 'decline' | 'cancel'
  /** User-retuned agent config from AutomationConfirmPrompt (collab-style editors). */
  agentConfig?: AgentRunConfig
  /** User-retuned enabled flag from the title-row Switch. */
  enabled?: boolean
}

/** Shared HITL registry for apply + delete (one pending prompt at a time per requestId). */
const automationConfirms = new HostConfirmRegistry<ConfirmOutcome>({
  idPrefix: 'automationconfirm',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Automation confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveAutomationConfirm(
  requestId: string,
  action: string,
  content?: Record<string, unknown>,
): boolean {
  const agentConfig = content?.agentConfig as AgentRunConfig | undefined
  const enabled = typeof content?.enabled === 'boolean' ? content.enabled : undefined
  return automationConfirms.settle(requestId, action === 'accept', {
    action: action as ConfirmOutcome['action'],
    ...(agentConfig ? { agentConfig } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  })
}

export function rejectAutomationConfirm(requestId: string, reason: string): boolean {
  return automationConfirms.fail(requestId, new Error(reason))
}

/** @deprecated Prefer resolveAutomationConfirm — kept for delete-named call sites. */
export const resolveAutomationDeleteConfirm = resolveAutomationConfirm
/** @deprecated Prefer rejectAutomationConfirm */
export const rejectAutomationDeleteConfirm = rejectAutomationConfirm

export function _resetAutomationConfirmsForTests(): void {
  automationConfirms.clearForTests()
}

/** @deprecated Prefer _resetAutomationConfirmsForTests */
export const _resetAutomationDeleteConfirmsForTests = _resetAutomationConfirmsForTests

async function awaitAutomationConfirm(
  session: SessionTitleSetter,
  opts: {
    toolName: 'mcp__superone__automation_apply' | 'mcp__superone__automation_delete'
    payload: AutomationConfirmPayload
    input: Record<string, unknown>
    riskLevel: 'low' | 'medium' | 'high'
    abortErrorMessage: string
    signal?: AbortSignal
  },
): Promise<ConfirmOutcome> {
  const subtitle = opts.payload.items
    .map((i) => i.name)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ')
  const more = opts.payload.items.length > 8 ? ` +${opts.payload.items.length - 8}` : ''
  return automationConfirms.open(
    session,
    (requestId) => ({
      requestId,
      toolName: opts.toolName,
      toolUseId: requestId,
      input: opts.input,
      allowAlwaysAllow: false,
      serverName: 'superone',
      requestKind: 'automation_confirm',
      automationConfirm: opts.payload,
      // Fallback for clients that only render message
      message: summarizeAutomationConfirm(opts.payload),
      ...(subtitle ? { subtitle: subtitle + more } : {}),
      riskLevel: opts.riskLevel,
    }),
    {
      signal: opts.signal,
      abortError: () => new Error(opts.abortErrorMessage),
    },
  )
}

/** Plain-text summary for logs / non-UI consumers. */
export function summarizeAutomationConfirm(payload: AutomationConfirmPayload): string {
  if (payload.operation === 'delete') {
    const lines = payload.items.map((i) => `${i.name}${i.id ? ` (${i.id.slice(0, 8)})` : ''}`)
    return `Permanently delete ${payload.items.length} automation(s)?\n${lines.slice(0, 15).join('\n')}`
  }
  if (payload.operation === 'create') {
    const item = payload.items[0]
    if (!item) return 'Create automation?'
    return [
      `Create automation "${item.name}"?`,
      item.scheduleSummary ? `Schedule: ${item.scheduleSummary}` : null,
      item.agentType ? `Agent: ${item.agentType}` : null,
      item.enabled !== undefined ? `Enabled: ${item.enabled ? 'yes' : 'no'}` : null,
      item.promptPreview ? `Prompt: ${item.promptPreview}` : null,
    ].filter(Boolean).join('\n')
  }
  // update
  const item = payload.items[0]
  const head = item
    ? `Update automation "${item.name}"${item.id ? ` (${item.id.slice(0, 8)})` : ''}?`
    : 'Update automation?'
  const changeLines = (payload.changes ?? []).map((c) => {
    if (c.from !== undefined && c.to !== undefined) return `${c.field}: ${c.from} → ${c.to}`
    if (c.to !== undefined) return `${c.field}: ${c.to}`
    return c.field
  })
  return [head, ...changeLines].join('\n')
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function toonResult(value: unknown) {
  return toolResult(toonEncode(value))
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.min(max, Math.floor(raw)))
}

function currentProjectPath(deps: BuiltInSuperoneToolDeps): string | null {
  return deps.sessionHost?.getSession(deps.sessionId)?.projectPath ?? null
}

function requireProject(deps: BuiltInSuperoneToolDeps):
  | { projectPath: string }
  | { error: ReturnType<typeof toolResult> } {
  const projectPath = currentProjectPath(deps)
  if (!projectPath) {
    return {
      error: toolResult(
        {
          status: 'error',
          message: 'No project path for the current session. Open a project first.',
        },
        true,
      ),
    }
  }
  return { projectPath }
}

const SCHEDULE_SUMMARY_MAX = 200

/** Human-readable schedule for list / confirm UI. Prefer agent-written `summary`. */
export function formatScheduleSummary(schedule: AutomationSchedule): string {
  const agentSummary = typeof schedule.summary === 'string' ? schedule.summary.trim() : ''
  if (agentSummary) {
    return agentSummary.length > SCHEDULE_SUMMARY_MAX
      ? `${agentSummary.slice(0, SCHEDULE_SUMMARY_MAX)}…`
      : agentSummary
  }
  // Fallback for legacy rows that only store machine fields.
  if (schedule.type === 'one-time') {
    if (schedule.runAt) {
      const d = schedule.runAt.length >= 16 ? schedule.runAt.slice(0, 16).replace('T', ' ') : schedule.runAt
      return `once @ ${d}`
    }
    return 'once'
  }
  if (schedule.preset && schedule.preset !== 'custom') {
    const time = schedule.timeOfDay ? ` ${schedule.timeOfDay}` : ''
    if (schedule.preset === 'hourly') {
      const min = typeof schedule.minuteOfHour === 'number' ? ` :${String(schedule.minuteOfHour).padStart(2, '0')}` : ''
      return `hourly${min}`
    }
    if (schedule.preset === 'weekly' && schedule.dayOfWeek?.length) {
      return `weekly d=${schedule.dayOfWeek.join(',')}${time}`
    }
    return `${schedule.preset}${time}`
  }
  if (schedule.cron) return `cron ${schedule.cron}`
  return 'recurring'
}

function promptPreview(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= AUTOMATION_PROMPT_PREVIEW) return oneLine
  return `${oneLine.slice(0, AUTOMATION_PROMPT_PREVIEW)}…`
}

function listRow(a: Automation) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    agent: a.agentConfig.type,
    schedule: formatScheduleSummary(a.schedule),
    lastRunStatus: a.lastRunStatus ?? null,
    lastRunAt: a.lastRunAt ?? null,
    nextRunAt: a.nextRunAt ?? null,
    promptPreview: promptPreview(a.prompt),
  }
}

function detailPayload(a: Automation) {
  return {
    id: a.id,
    name: a.name,
    prompt: a.prompt,
    enabled: a.enabled,
    agentConfig: a.agentConfig,
    schedule: a.schedule,
    scheduleSummary: formatScheduleSummary(a.schedule),
    lastRunAt: a.lastRunAt ?? null,
    lastRunStatus: a.lastRunStatus ?? null,
    lastRunSessionId: a.lastRunSessionId ?? null,
    nextRunAt: a.nextRunAt ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

function sameProject(automation: Automation, projectPath: string): boolean {
  return automation.projectPath === projectPath
}

// ─── List ───

export interface AutomationListArgs {
  /** When set, return full detail for this automation (must belong to current project). */
  id?: string
  /** Filter by enabled state. Omit for all. */
  enabled?: boolean
  /** Case-insensitive name substring filter. */
  query?: string
  limit?: number
  offset?: number
}

export function automationListHandler(args: AutomationListArgs, deps: BuiltInSuperoneToolDeps) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (id) {
    const found = getAutomation(id)
    if (!found || !sameProject(found, project.projectPath)) {
      return toolResult(
        {
          status: 'error',
          message: `Automation not found in current project: ${id}. Call automation_list without id to discover ids.`,
        },
        true,
      )
    }
    return toolResult({ status: 'ok', automation: detailPayload(found) })
  }

  let items = listAutomationsForProject(project.projectPath)
  if (typeof args.enabled === 'boolean') {
    items = items.filter((a) => a.enabled === args.enabled)
  }
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  if (query) {
    items = items.filter((a) => a.name.toLowerCase().includes(query))
  }

  const limit = clampLimit(args.limit, AUTOMATION_LIST_DEFAULT_LIMIT, AUTOMATION_LIST_MAX_LIMIT)
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : 0
  const total = items.length
  const page = items.slice(offset, offset + limit)

  return toonResult({
    status: 'ok',
    count: page.length,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
    automations: page.map(listRow),
  })
}

// ─── Apply (create / update / toggle) ───

export interface AutomationApplyArgs {
  action: 'create' | 'update'
  /** Required for update. Automation id from automation_list. */
  id?: string
  name?: string
  prompt?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  agentConfig?: AgentRunConfig
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function parseSchedule(raw: unknown): AutomationSchedule | { error: string } {
  if (!isRecord(raw)) return { error: 'schedule must be an object.' }
  const type = raw.type
  if (type !== 'one-time' && type !== 'recurring') {
    return { error: 'schedule.type must be "one-time" or "recurring".' }
  }
  const schedule: AutomationSchedule = { type }
  if (typeof raw.cron === 'string') schedule.cron = raw.cron.trim()
  if (typeof raw.runAt === 'string') schedule.runAt = raw.runAt.trim()
  if (
    raw.preset === 'hourly'
    || raw.preset === 'daily'
    || raw.preset === 'weekly'
    || raw.preset === 'custom'
  ) {
    schedule.preset = raw.preset
  }
  if (typeof raw.timeOfDay === 'string') schedule.timeOfDay = raw.timeOfDay
  if (Array.isArray(raw.dayOfWeek)) {
    if (!raw.dayOfWeek.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { error: 'schedule.dayOfWeek must be integers 0–6 (0=Sun … 6=Sat).' }
    }
    schedule.dayOfWeek = raw.dayOfWeek as number[]
  }
  if (raw.minuteOfHour !== undefined) {
    if (typeof raw.minuteOfHour !== 'number' || !Number.isInteger(raw.minuteOfHour) || raw.minuteOfHour < 0 || raw.minuteOfHour > 59) {
      return { error: 'schedule.minuteOfHour must be an integer 0–59.' }
    }
    schedule.minuteOfHour = raw.minuteOfHour
  }
  if (raw.summary !== undefined) {
    if (typeof raw.summary !== 'string' || !raw.summary.trim()) {
      return {
        error:
          'schedule.summary must be a non-empty natural-language description for the user UI '
          + '(e.g. "Every weekday at 9:00 AM" / "每天上午 9 点").',
      }
    }
    const summary = raw.summary.trim()
    if (summary.length > SCHEDULE_SUMMARY_MAX) {
      return { error: `schedule.summary must be ≤ ${SCHEDULE_SUMMARY_MAX} characters.` }
    }
    schedule.summary = summary
  }

  if (type === 'one-time') {
    if (!schedule.runAt) {
      return { error: 'one-time schedule requires runAt (ISO timestamp).' }
    }
    const ms = Date.parse(schedule.runAt)
    if (!Number.isFinite(ms)) {
      return {
        error: `Invalid runAt "${schedule.runAt}". Use an ISO timestamp, e.g. "2026-05-01T09:00:00.000Z".`,
      }
    }
    // Normalize so next_run_at / lexicographic due checks stay consistent.
    schedule.runAt = new Date(ms).toISOString()
  }
  if (type === 'recurring') {
    if (!schedule.cron) {
      return { error: 'recurring schedule requires cron (e.g. "0 9 * * *").' }
    }
    const next = computeNextRunAt(schedule)
    if (!next) {
      return {
        error: `Invalid or unusable cron "${schedule.cron}". Use a standard 5-field expression (e.g. "0 9 * * *").`,
      }
    }
  }
  return schedule
}

const PERMISSION_MODES = new Set([
  'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'agent',
])
const SANDBOX_MODES = new Set(['off', 'on', 'auto'])
const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const CODEX_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])
const CODEX_PRESETS = new Set(['default', 'full-access', 'read-only'])

function parseAgentConfig(raw: unknown): AgentRunConfig | { error: string } {
  if (!isRecord(raw)) return { error: 'agentConfig must be an object.' }
  const type = raw.type
  if (type === 'claude') {
    const cfg: ClaudeRunConfig = { type: 'claude' }
    if (typeof raw.agentName === 'string') cfg.agentName = raw.agentName
    if (typeof raw.model === 'string') cfg.model = raw.model
    if (typeof raw.effort === 'string' && CLAUDE_EFFORTS.has(raw.effort)) {
      cfg.effort = raw.effort as ClaudeRunConfig['effort']
    }
    if (typeof raw.permissionMode === 'string' && PERMISSION_MODES.has(raw.permissionMode)) {
      cfg.permissionMode = raw.permissionMode as ClaudeRunConfig['permissionMode']
    }
    if (typeof raw.sandboxMode === 'string' && SANDBOX_MODES.has(raw.sandboxMode)) {
      cfg.sandboxMode = raw.sandboxMode as ClaudeRunConfig['sandboxMode']
    }
    if (raw.apiProviderId === null || typeof raw.apiProviderId === 'string') {
      cfg.apiProviderId = raw.apiProviderId as string | null
    }
    return cfg
  }
  if (type === 'codex') {
    const cfg: CodexRunConfig = { type: 'codex' }
    if (typeof raw.model === 'string') cfg.model = raw.model
    const effortRaw = typeof raw.effort === 'string' ? raw.effort : typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort : undefined
    if (effortRaw && CODEX_EFFORTS.has(effortRaw)) {
      cfg.effort = effortRaw
      cfg.reasoningEffort = effortRaw as CodexRunConfig['reasoningEffort']
    }
    if (typeof raw.permissionPreset === 'string' && CODEX_PRESETS.has(raw.permissionPreset)) {
      cfg.permissionPreset = raw.permissionPreset as CodexRunConfig['permissionPreset']
    }
    if (typeof raw.permissionMode === 'string' && PERMISSION_MODES.has(raw.permissionMode)) {
      cfg.permissionMode = raw.permissionMode as CodexRunConfig['permissionMode']
    }
    if (raw.apiProviderId === null || typeof raw.apiProviderId === 'string') {
      cfg.apiProviderId = raw.apiProviderId as string | null
    }
    return cfg
  }
  if (type === 'acp') {
    const cfg: import('@superone/shared/agent-types').AcpRunConfig = { type: 'acp' }
    if (typeof raw.acpAgentId === 'string') cfg.acpAgentId = raw.acpAgentId
    if (typeof raw.model === 'string') cfg.model = raw.model
    if (typeof raw.effort === 'string') cfg.effort = raw.effort
    if (typeof raw.permissionMode === 'string' && PERMISSION_MODES.has(raw.permissionMode)) {
      cfg.permissionMode = raw.permissionMode as ClaudeRunConfig['permissionMode']
    }
    if (raw.apiProviderId === null || typeof raw.apiProviderId === 'string') {
      cfg.apiProviderId = raw.apiProviderId as string | null
    }
    return cfg
  }
  if (type === 'opencode') {
    const cfg: import('@superone/shared/agent-types').OpenCodeRunConfig = { type: 'opencode' }
    if (typeof raw.model === 'string') cfg.model = raw.model
    if (typeof raw.effort === 'string') cfg.effort = raw.effort
    if (typeof raw.permissionMode === 'string' && PERMISSION_MODES.has(raw.permissionMode)) {
      cfg.permissionMode = raw.permissionMode as ClaudeRunConfig['permissionMode']
    }
    if (raw.apiProviderId === null || typeof raw.apiProviderId === 'string') {
      cfg.apiProviderId = raw.apiProviderId as string | null
    }
    return cfg
  }
  return { error: 'agentConfig.type must be "claude", "codex", "acp", or "opencode".' }
}

const DEFAULT_CLAUDE_CONFIG: ClaudeRunConfig = {
  type: 'claude',
  permissionMode: 'bypassPermissions',
  sandboxMode: 'off',
}

const DEFAULT_CODEX_CONFIG: CodexRunConfig = {
  type: 'codex',
  permissionPreset: 'full-access',
  permissionMode: 'bypassPermissions',
}

const DEFAULT_ACP_CONFIG: import('@superone/shared/agent-types').AcpRunConfig = {
  type: 'acp',
  permissionMode: 'bypassPermissions',
}

const DEFAULT_OPENCODE_CONFIG: import('@superone/shared/agent-types').OpenCodeRunConfig = {
  type: 'opencode',
  permissionMode: 'bypassPermissions',
}

function defaultConfigForType(type: AgentRunConfig['type']): AgentRunConfig {
  if (type === 'codex') return DEFAULT_CODEX_CONFIG
  if (type === 'acp') return DEFAULT_ACP_CONFIG
  if (type === 'opencode') return DEFAULT_OPENCODE_CONFIG
  return DEFAULT_CLAUDE_CONFIG
}

/** Apply harness defaults so sparse create configs still show privilege level in confirm. */
function withAgentDefaults(config: AgentRunConfig): AgentRunConfig {
  return mergeAgentConfig(defaultConfigForType(config.type), config)
}

/**
 * Merge a sparse agentConfig patch into the existing config on update.
 * Type switch replaces the base (new harness fields only). Same type keeps
 * unspecified model/effort/permission/sandbox from existing.
 */
export function mergeAgentConfig(existing: AgentRunConfig, patch: AgentRunConfig): AgentRunConfig {
  if (patch.type !== existing.type) return patch
  if (patch.type === 'claude' && existing.type === 'claude') {
    return {
      type: 'claude',
      agentName: patch.agentName ?? existing.agentName,
      model: patch.model ?? existing.model,
      effort: patch.effort ?? existing.effort,
      permissionMode: patch.permissionMode ?? existing.permissionMode,
      sandboxMode: patch.sandboxMode ?? existing.sandboxMode,
      apiProviderId: patch.apiProviderId !== undefined ? patch.apiProviderId : existing.apiProviderId,
    }
  }
  if (patch.type === 'codex' && existing.type === 'codex') {
    const effort = patch.effort ?? patch.reasoningEffort ?? existing.effort ?? existing.reasoningEffort
    return {
      type: 'codex',
      model: patch.model ?? existing.model,
      ...(effort
        ? { effort, reasoningEffort: effort as CodexRunConfig['reasoningEffort'] }
        : {}),
      permissionMode: patch.permissionMode ?? existing.permissionMode,
      permissionPreset: patch.permissionPreset ?? existing.permissionPreset,
      apiProviderId: patch.apiProviderId !== undefined ? patch.apiProviderId : existing.apiProviderId,
    }
  }
  if (patch.type === 'acp' && existing.type === 'acp') {
    return {
      type: 'acp',
      acpAgentId: patch.acpAgentId ?? existing.acpAgentId,
      model: patch.model ?? existing.model,
      effort: patch.effort ?? existing.effort,
      permissionMode: patch.permissionMode ?? existing.permissionMode,
      apiProviderId: patch.apiProviderId !== undefined ? patch.apiProviderId : existing.apiProviderId,
    }
  }
  if (patch.type === 'opencode' && existing.type === 'opencode') {
    return {
      type: 'opencode',
      model: patch.model ?? existing.model,
      effort: patch.effort ?? existing.effort,
      permissionMode: patch.permissionMode ?? existing.permissionMode,
      apiProviderId: patch.apiProviderId !== undefined ? patch.apiProviderId : existing.apiProviderId,
    }
  }
  return patch
}

/** Map stored agentConfig → collab-style view (permissionMode unified for all harnesses). */
export function toAgentView(config: AgentRunConfig): AutomationConfirmAgentView {
  if (config.type === 'claude') {
    return {
      type: 'claude',
      ...(config.model ? { model: config.model } : {}),
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
      ...(config.sandboxMode ? { sandboxMode: config.sandboxMode } : {}),
      ...(config.apiProviderId !== undefined ? { apiProviderId: config.apiProviderId } : {}),
    }
  }
  if (config.type === 'codex') {
    const effort = config.effort ?? config.reasoningEffort
    const permissionMode =
      config.permissionMode
      ?? (config.permissionPreset === 'full-access' ? 'bypassPermissions' : 'default')
    return {
      type: 'codex',
      ...(config.model ? { model: config.model } : {}),
      ...(effort ? { effort } : {}),
      permissionMode,
      ...(config.permissionPreset ? { permissionPreset: config.permissionPreset } : {}),
      ...(config.apiProviderId !== undefined ? { apiProviderId: config.apiProviderId } : {}),
    }
  }
  if (config.type === 'acp') {
    return {
      type: 'acp',
      ...(config.acpAgentId ? { acpAgentId: config.acpAgentId } : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
      ...(config.apiProviderId !== undefined ? { apiProviderId: config.apiProviderId } : {}),
    }
  }
  return {
    type: 'opencode',
    ...(config.model ? { model: config.model } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config.apiProviderId !== undefined ? { apiProviderId: config.apiProviderId } : {}),
  }
}

/** Convert confirm UI edits back to AgentRunConfig for persistence / execute. */
export function agentViewToConfig(view: AutomationConfirmAgentView): AgentRunConfig {
  if (view.type === 'claude') {
    return {
      type: 'claude',
      ...(view.model ? { model: view.model } : {}),
      ...(view.effort ? { effort: view.effort as ClaudeRunConfig['effort'] } : {}),
      ...(view.permissionMode ? { permissionMode: view.permissionMode } : {}),
      ...(view.sandboxMode ? { sandboxMode: view.sandboxMode } : {}),
      ...(view.apiProviderId !== undefined ? { apiProviderId: view.apiProviderId } : {}),
    }
  }
  if (view.type === 'codex') {
    const permissionPreset =
      view.permissionPreset
      ?? (view.permissionMode === 'bypassPermissions' || view.permissionMode === 'acceptEdits'
        ? 'full-access'
        : 'default')
    return {
      type: 'codex',
      ...(view.model ? { model: view.model } : {}),
      ...(view.effort ? { effort: view.effort, reasoningEffort: view.effort as CodexRunConfig['reasoningEffort'] } : {}),
      permissionMode: view.permissionMode ?? (permissionPreset === 'full-access' ? 'bypassPermissions' : 'default'),
      permissionPreset,
      ...(view.apiProviderId !== undefined ? { apiProviderId: view.apiProviderId } : {}),
    }
  }
  if (view.type === 'acp') {
    return {
      type: 'acp',
      ...(view.acpAgentId ? { acpAgentId: view.acpAgentId } : {}),
      ...(view.model ? { model: view.model } : {}),
      ...(view.effort ? { effort: view.effort } : {}),
      ...(view.permissionMode ? { permissionMode: view.permissionMode } : {}),
      ...(view.apiProviderId !== undefined ? { apiProviderId: view.apiProviderId } : {}),
    }
  }
  return {
    type: 'opencode',
    ...(view.model ? { model: view.model } : {}),
    ...(view.effort ? { effort: view.effort } : {}),
    ...(view.permissionMode ? { permissionMode: view.permissionMode } : {}),
    ...(view.apiProviderId !== undefined ? { apiProviderId: view.apiProviderId } : {}),
  }
}

/** Privilege-aware plain-text fallback (logs / clients without structured UI). */
export function formatAgentSummary(config: AgentRunConfig): string {
  const view = toAgentView(config)
  const parts: string[] = [view.type]
  if (view.permissionMode) parts.push(view.permissionMode)
  if (view.sandboxMode) parts.push(`sandbox ${view.sandboxMode}`)
  if (view.model) parts.push(view.model)
  if (view.effort) parts.push(view.effort)
  if (view.acpAgentId) parts.push(view.acpAgentId)
  return parts.join(' · ')
}

function toConfirmItem(
  partial: {
    id?: string
    name: string
    schedule: AutomationSchedule
    agentConfig: AgentRunConfig
    enabled?: boolean
    prompt?: string
    /** When true, omit full prompt body (e.g. delete list rows). */
    omitPromptBody?: boolean
  },
): AutomationConfirmItem {
  return {
    id: partial.id,
    name: partial.name,
    scheduleSummary: formatScheduleSummary(partial.schedule),
    agentType: partial.agentConfig.type,
    agentSummary: formatAgentSummary(partial.agentConfig),
    agent: toAgentView(partial.agentConfig),
    enabled: partial.enabled,
    ...(partial.prompt !== undefined && !partial.omitPromptBody
      ? { prompt: partial.prompt, promptPreview: promptPreview(partial.prompt) }
      : partial.prompt !== undefined
        ? { promptPreview: promptPreview(partial.prompt) }
        : {}),
  }
}

function requireConfirmSession(deps: BuiltInSuperoneToolDeps) {
  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.emitHostEvent) {
    return {
      error: toolResult(
        {
          status: 'error',
          message: 'Cannot open confirmation: current session host is unavailable.',
        },
        true,
      ),
    }
  }
  return { session }
}

function confirmOutcomeResult(
  outcome: ConfirmOutcome,
  rejectedMessage: string,
): ReturnType<typeof toolResult> | null {
  if (outcome.action === 'accept') return null
  return toolResult({
    status: outcome.action === 'cancel' ? 'cancelled' : 'rejected',
    message: rejectedMessage,
  })
}

function confirmCatchResult(err: unknown): ReturnType<typeof toolResult> {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed out|cancelled/i.test(msg)) {
    return toolResult({ status: 'cancelled', message: msg })
  }
  return toolResult({ status: 'error', message: msg }, true)
}

function buildCreateConfirmPayload(
  data: CreateAutomationRequest,
  enabled: boolean,
): AutomationConfirmPayload {
  return {
    operation: 'create',
    items: [
      toConfirmItem({
        name: data.name,
        schedule: data.schedule,
        agentConfig: data.agentConfig,
        enabled,
        prompt: data.prompt,
      }),
    ],
  }
}

function enabledLabel(on: boolean): string {
  return on ? 'on' : 'off'
}

function buildUpdateConfirmPayload(
  existing: Automation,
  patch: UpdateAutomationRequest,
  /** Final agentConfig after merge (when patch includes agentConfig). */
  nextAgentConfig?: AgentRunConfig,
): AutomationConfirmPayload {
  const changes: AutomationConfirmChange[] = []
  if (patch.name !== undefined) {
    changes.push({ field: 'name', from: existing.name, to: patch.name })
  }
  if (patch.enabled !== undefined) {
    changes.push({
      field: 'enabled',
      from: enabledLabel(existing.enabled),
      to: enabledLabel(patch.enabled),
    })
  }
  if (patch.schedule !== undefined) {
    changes.push({
      field: 'schedule',
      from: formatScheduleSummary(existing.schedule),
      to: formatScheduleSummary(patch.schedule),
    })
  }
  if (nextAgentConfig !== undefined) {
    const from = formatAgentSummary(existing.agentConfig)
    const to = formatAgentSummary(nextAgentConfig)
    if (from !== to) {
      changes.push({
        field: 'agent',
        from,
        to,
        agentFrom: toAgentView(existing.agentConfig),
        agentTo: toAgentView(nextAgentConfig),
      })
    }
  }
  if (patch.prompt !== undefined) {
    changes.push({
      field: 'prompt',
      from: promptPreview(existing.prompt),
      to: promptPreview(patch.prompt),
    })
  }
  const agentConfig = nextAgentConfig ?? existing.agentConfig
  return {
    operation: 'update',
    items: [
      toConfirmItem({
        id: existing.id,
        name: patch.name ?? existing.name,
        schedule: patch.schedule ?? existing.schedule,
        agentConfig,
        enabled: patch.enabled ?? existing.enabled,
        prompt: patch.prompt ?? existing.prompt,
      }),
    ],
    changes,
  }
}

function buildDeleteConfirmPayload(items: Automation[]): AutomationConfirmPayload {
  return {
    operation: 'delete',
    items: items.map((a) =>
      toConfirmItem({
        id: a.id,
        name: a.name,
        schedule: a.schedule,
        agentConfig: a.agentConfig,
        enabled: a.enabled,
        // Delete rows only need name + schedule — skip prompt payload bulk.
        omitPromptBody: true,
      }),
    ),
  }
}

export async function automationApplyHandler(args: AutomationApplyArgs, deps: BuiltInSuperoneToolDeps) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  const action = args.action
  if (action !== 'create' && action !== 'update') {
    return toolResult(
      {
        status: 'error',
        message: 'action must be "create" or "update". Use automation_delete to remove automations.',
      },
      true,
    )
  }

  if (action === 'create') {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    const prompt = typeof args.prompt === 'string' ? args.prompt : ''
    if (!name) {
      return toolResult({ status: 'error', message: 'create requires name (non-empty string).' }, true)
    }
    if (!prompt.trim()) {
      return toolResult({ status: 'error', message: 'create requires prompt (non-empty string).' }, true)
    }
    if (args.schedule === undefined) {
      return toolResult(
        {
          status: 'error',
          message:
            'create requires schedule. Example: { type: "recurring", cron: "0 9 * * *", preset: "daily", timeOfDay: "09:00" } or { type: "one-time", runAt: "2026-05-01T09:00:00.000Z" }.',
        },
        true,
      )
    }
    const schedule = parseSchedule(args.schedule)
    if ('error' in schedule) {
      return toolResult({ status: 'error', message: schedule.error }, true)
    }
    let agentConfig: AgentRunConfig = DEFAULT_CLAUDE_CONFIG
    if (args.agentConfig !== undefined) {
      const parsed = parseAgentConfig(args.agentConfig)
      if ('error' in parsed) {
        return toolResult({ status: 'error', message: parsed.error }, true)
      }
      agentConfig = withAgentDefaults(parsed)
    }

    const data: CreateAutomationRequest = { name, prompt, agentConfig, schedule }
    const wantEnabled = args.enabled !== false
    const host = requireConfirmSession(deps)
    if ('error' in host) return host.error

    let outcome: ConfirmOutcome
    try {
      outcome = await awaitAutomationConfirm(host.session, {
        toolName: 'mcp__superone__automation_apply',
        payload: buildCreateConfirmPayload(data, wantEnabled),
        input: { action: 'create', name, enabled: wantEnabled },
        riskLevel: 'medium',
        abortErrorMessage: 'Automation create cancelled',
        signal: deps.signal,
      })
    } catch (err) {
      return confirmCatchResult(err)
    }
    const denied = confirmOutcomeResult(outcome, 'User did not approve automation create.')
    if (denied) return denied

    // User may retune model / permission / sandbox / enabled in the confirm UI.
    if (outcome.agentConfig) {
      data.agentConfig = withAgentDefaults(outcome.agentConfig)
    }
    const finalEnabled = outcome.enabled !== undefined ? outcome.enabled : wantEnabled

    try {
      const created = createAutomation(project.projectPath, data)
      // create always inserts enabled=1; honor enabled:false via update
      if (!finalEnabled) {
        const disabled = updateAutomation(created.id, { enabled: false })
        if (!disabled || disabled.enabled !== false) {
          deleteAutomation(created.id)
          return toolResult(
            {
              status: 'error',
              message: 'Created automation but failed to set enabled=false; rolled back the create.',
            },
            true,
          )
        }
        notifyAutomationsListChanged(project.projectPath)
        return toolResult({
          status: 'ok',
          action: 'create',
          automation: detailPayload(disabled),
        })
      }
      notifyAutomationsListChanged(project.projectPath)
      return toolResult({
        status: 'ok',
        action: 'create',
        automation: detailPayload(created),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[automation_apply] create failed: %s', message)
      return toolResult({ status: 'error', message }, true)
    }
  }

  // update
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (!id) {
    return toolResult(
      {
        status: 'error',
        message: 'update requires id. Call automation_list first to discover automation ids.',
      },
      true,
    )
  }
  const existing = getAutomation(id)
  if (!existing || !sameProject(existing, project.projectPath)) {
    return toolResult(
      {
        status: 'error',
        message: `Automation not found in current project: ${id}. Call automation_list without id to discover ids.`,
      },
      true,
    )
  }

  const patch: UpdateAutomationRequest = {}
  if (typeof args.name === 'string') {
    const name = args.name.trim()
    if (!name) return toolResult({ status: 'error', message: 'name must be non-empty when provided.' }, true)
    patch.name = name
  }
  if (typeof args.prompt === 'string') {
    if (!args.prompt.trim()) {
      return toolResult({ status: 'error', message: 'prompt must be non-empty when provided.' }, true)
    }
    patch.prompt = args.prompt
  }
  if (typeof args.enabled === 'boolean') patch.enabled = args.enabled
  if (args.schedule !== undefined) {
    const schedule = parseSchedule(args.schedule)
    if ('error' in schedule) {
      return toolResult({ status: 'error', message: schedule.error }, true)
    }
    patch.schedule = schedule
  }
  let nextAgentConfig: AgentRunConfig | undefined
  if (args.agentConfig !== undefined) {
    const agentConfig = parseAgentConfig(args.agentConfig)
    if ('error' in agentConfig) {
      return toolResult({ status: 'error', message: agentConfig.error }, true)
    }
    // Patch semantics: sparse agentConfig merges into existing so model/effort/sandbox
    // are not wiped when the model only sends permissionMode. Type switch still gets
    // harness defaults (e.g. codex full-access) for honest confirm UI.
    nextAgentConfig = withAgentDefaults(mergeAgentConfig(existing.agentConfig, agentConfig))
    patch.agentConfig = nextAgentConfig
  }

  if (Object.keys(patch).length === 0) {
    return toolResult(
      {
        status: 'error',
        message: 'update requires at least one of: name, prompt, enabled, schedule, agentConfig.',
      },
      true,
    )
  }

  const host = requireConfirmSession(deps)
  if ('error' in host) return host.error

  let outcome: ConfirmOutcome
  try {
    outcome = await awaitAutomationConfirm(host.session, {
      toolName: 'mcp__superone__automation_apply',
      payload: buildUpdateConfirmPayload(existing, patch, nextAgentConfig),
      input: { action: 'update', id, ...patch },
      riskLevel: 'medium',
      abortErrorMessage: 'Automation update cancelled',
      signal: deps.signal,
    })
  } catch (err) {
    return confirmCatchResult(err)
  }
  const denied = confirmOutcomeResult(outcome, 'User did not approve automation update.')
  if (denied) return denied

  // Confirm UI can retune agent / enabled even when the MCP call omitted them.
  if (outcome.agentConfig) {
    patch.agentConfig = withAgentDefaults(
      mergeAgentConfig(existing.agentConfig, outcome.agentConfig),
    )
  }
  if (outcome.enabled !== undefined) {
    patch.enabled = outcome.enabled
  }

  try {
    const updated = updateAutomation(id, patch)
    if (!updated) {
      return toolResult({ status: 'error', message: `Automation not found: ${id}` }, true)
    }
    notifyAutomationsListChanged(project.projectPath)
    return toolResult({
      status: 'ok',
      action: 'update',
      automation: detailPayload(updated),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('[automation_apply] update failed: %s', message)
    return toolResult({ status: 'error', message }, true)
  }
}

// ─── Delete (HITL confirm) ───

export interface AutomationDeleteArgs {
  /** Automation ids from automation_list (current project only). */
  ids: string[]
}

export async function automationDeleteHandler(
  args: AutomationDeleteArgs,
  deps: BuiltInSuperoneToolDeps,
) {
  const project = requireProject(deps)
  if ('error' in project) return project.error

  if (!(Array.isArray(args.ids) && args.ids.length > 0)) {
    return toolResult(
      {
        status: 'error',
        message: 'ids is required. Call automation_list to find ids, then pass them here.',
      },
      true,
    )
  }

  const rawIds = args.ids
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  if (rawIds.length === 0) {
    return toolResult({ status: 'error', message: 'ids must contain at least one non-empty string.' }, true)
  }

  // Dedupe while preserving order
  const seen = new Set<string>()
  const uniqueIds: string[] = []
  for (const id of rawIds) {
    if (seen.has(id)) continue
    seen.add(id)
    uniqueIds.push(id)
  }
  if (uniqueIds.length > AUTOMATION_DELETE_MAX) {
    return toolResult(
      {
        status: 'error',
        message: `At most ${AUTOMATION_DELETE_MAX} automations per delete call. Split into multiple calls.`,
      },
      true,
    )
  }

  const found: Automation[] = []
  const notFound: string[] = []
  const wrongProject: string[] = []
  for (const id of uniqueIds) {
    const a = getAutomation(id)
    if (!a) {
      notFound.push(id)
      continue
    }
    if (!sameProject(a, project.projectPath)) {
      wrongProject.push(id)
      continue
    }
    found.push(a)
  }

  if (found.length === 0) {
    return toolResult({
      status: 'not_found',
      deleted: [],
      notFound,
      wrongProject,
      message:
        'No matching automations in the current project to delete. Call automation_list to refresh ids.',
    })
  }

  const host = requireConfirmSession(deps)
  if ('error' in host) return host.error

  let outcome: ConfirmOutcome
  try {
    outcome = await awaitAutomationConfirm(host.session, {
      toolName: 'mcp__superone__automation_delete',
      payload: buildDeleteConfirmPayload(found),
      input: { ids: found.map((a) => a.id) },
      riskLevel: 'high',
      abortErrorMessage: 'Automation delete cancelled',
      signal: deps.signal,
    })
  } catch (err) {
    return confirmCatchResult(err)
  }
  const denied = confirmOutcomeResult(outcome, 'User did not approve automation deletion.')
  if (denied) return denied

  const deleted: Array<{ id: string; name: string }> = []
  const failed: Array<{ id: string; name: string; error: string }> = []
  for (const a of found) {
    try {
      const ok = deleteAutomation(a.id)
      if (ok) deleted.push({ id: a.id, name: a.name })
      else failed.push({ id: a.id, name: a.name, error: 'not found at delete time' })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[automation_delete] failed id=%s: %s', a.id, error)
      failed.push({ id: a.id, name: a.name, error })
    }
  }

  if (deleted.length > 0) {
    notifyAutomationsListChanged(project.projectPath)
  }

  const status =
    failed.length === 0
      ? 'ok'
      : deleted.length === 0
        ? 'error'
        : 'partial'

  return toolResult(
    {
      status,
      deleted,
      ...(failed.length > 0 ? { failed } : {}),
      ...(notFound.length > 0 ? { notFound } : {}),
      ...(wrongProject.length > 0 ? { wrongProject } : {}),
    },
    status === 'error',
  )
}
