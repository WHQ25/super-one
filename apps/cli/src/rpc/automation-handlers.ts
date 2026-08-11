/**
 * Automation CRUD + runNow RPC handlers (desktop automation parity on node).
 * Methods: automation.list|create|update|delete|runNow
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type NodeAutomation,
  type RpcErrorCode,
} from '@superone/shared/environment'
import type {
  AgentRunConfig,
  AutomationSchedule,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@superone/shared/agent-types'
import type { AutomationService } from '@superone/runtime/automations'
import type { AutomationStore } from '@superone/runtime/automations'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'

export interface AutomationRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface AutomationRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  automations: AutomationStore
  automationService: AutomationService
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): AutomationRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): AutomationRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

function toNodeAutomation(row: {
  id: string
  projectId: string
  projectPath: string
  name: string
  prompt: string
  agentConfig: AgentRunConfig
  schedule: AutomationSchedule
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: NodeAutomation['lastRunStatus']
  lastRunSessionId?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}): NodeAutomation {
  return {
    id: row.id,
    projectId: row.projectId,
    projectPath: row.projectPath,
    name: row.name,
    prompt: row.prompt,
    agentConfig: row.agentConfig,
    schedule: row.schedule,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus,
    lastRunSessionId: row.lastRunSessionId,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseAgentConfig(raw: unknown): AgentRunConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (c.type === 'claude') {
    return {
      type: 'claude',
      ...(typeof c.agentName === 'string' ? { agentName: c.agentName } : {}),
      ...(typeof c.model === 'string' ? { model: c.model } : {}),
      ...(typeof c.effort === 'string' ? { effort: c.effort as never } : {}),
      ...(typeof c.permissionMode === 'string' ? { permissionMode: c.permissionMode as never } : {}),
      ...(typeof c.sandboxMode === 'string' ? { sandboxMode: c.sandboxMode as never } : {}),
      ...(c.apiProviderId === null || typeof c.apiProviderId === 'string'
        ? { apiProviderId: c.apiProviderId as string | null }
        : {}),
    }
  }
  if (c.type === 'codex') {
    const effort =
      typeof c.effort === 'string'
        ? c.effort
        : typeof c.reasoningEffort === 'string'
          ? c.reasoningEffort
          : undefined
    return {
      type: 'codex',
      ...(typeof c.model === 'string' ? { model: c.model } : {}),
      ...(effort
        ? { effort, reasoningEffort: effort as never }
        : {}),
      ...(typeof c.permissionMode === 'string' ? { permissionMode: c.permissionMode as never } : {}),
      ...(typeof c.permissionPreset === 'string' ? { permissionPreset: c.permissionPreset as never } : {}),
      ...(c.apiProviderId === null || typeof c.apiProviderId === 'string'
        ? { apiProviderId: c.apiProviderId as string | null }
        : {}),
    }
  }
  if (c.type === 'acp') {
    return {
      type: 'acp',
      ...(typeof c.acpAgentId === 'string' ? { acpAgentId: c.acpAgentId } : {}),
      ...(typeof c.model === 'string' ? { model: c.model } : {}),
      ...(typeof c.effort === 'string' ? { effort: c.effort } : {}),
      ...(typeof c.permissionMode === 'string' ? { permissionMode: c.permissionMode as never } : {}),
      ...(c.apiProviderId === null || typeof c.apiProviderId === 'string'
        ? { apiProviderId: c.apiProviderId as string | null }
        : {}),
    }
  }
  if (c.type === 'opencode') {
    return {
      type: 'opencode',
      ...(typeof c.model === 'string' ? { model: c.model } : {}),
      ...(typeof c.effort === 'string' ? { effort: c.effort } : {}),
      ...(typeof c.permissionMode === 'string' ? { permissionMode: c.permissionMode as never } : {}),
      ...(c.apiProviderId === null || typeof c.apiProviderId === 'string'
        ? { apiProviderId: c.apiProviderId as string | null }
        : {}),
    }
  }
  return null
}

function parseSchedule(raw: unknown): AutomationSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.type !== 'one-time' && s.type !== 'recurring') return null
  const summary = typeof s.summary === 'string' ? s.summary.trim() : ''
  return {
    type: s.type,
    ...(typeof s.cron === 'string' ? { cron: s.cron } : {}),
    ...(typeof s.runAt === 'string' ? { runAt: s.runAt } : {}),
    ...(typeof s.preset === 'string'
      ? { preset: s.preset as AutomationSchedule['preset'] }
      : {}),
    ...(typeof s.timeOfDay === 'string' ? { timeOfDay: s.timeOfDay } : {}),
    ...(Array.isArray(s.dayOfWeek)
      ? { dayOfWeek: s.dayOfWeek.filter((x): x is number => typeof x === 'number') }
      : {}),
    ...(typeof s.minuteOfHour === 'number' ? { minuteOfHour: s.minuteOfHour } : {}),
    ...(summary ? { summary } : {}),
  }
}

export function handleAutomationList(payload: unknown, ctx: AutomationRpcContext): AutomationRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = String(p.projectId ?? '').trim()
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId is required' } }
  }
  const project = ctx.projects.get(projectId)
  if (!project) {
    return { error: { code: 'not_found', message: `unknown projectId: ${projectId}` } }
  }
  try {
    const rows = ctx.automations.listForProject(projectId, project.path)
    return { result: { automations: rows.map(toNodeAutomation) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAutomationCreate(payload: unknown, ctx: AutomationRpcContext): AutomationRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = String(p.projectId ?? '').trim()
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId is required' } }
  }
  const project = ctx.projects.get(projectId)
  if (!project) {
    return { error: { code: 'not_found', message: `unknown projectId: ${projectId}` } }
  }
  const name = String(p.name ?? '').trim()
  const prompt = String(p.prompt ?? '')
  if (!name) {
    return { error: { code: 'invalid_argument', message: 'name is required' } }
  }
  if (!prompt.trim()) {
    return { error: { code: 'invalid_argument', message: 'prompt is required' } }
  }
  const agentConfig = parseAgentConfig(p.agentConfig)
  if (!agentConfig) {
    return { error: { code: 'invalid_argument', message: 'agentConfig.type must be claude, codex, acp, or opencode' } }
  }
  const schedule = parseSchedule(p.schedule)
  if (!schedule) {
    return { error: { code: 'invalid_argument', message: 'schedule.type must be one-time or recurring' } }
  }
  try {
    const data: CreateAutomationRequest = { name, prompt, agentConfig, schedule }
    const row = ctx.automations.create(projectId, project.path, data)
    ctx.projects.touch(projectId)
    return { result: { automation: toNodeAutomation(row) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAutomationUpdate(payload: unknown, ctx: AutomationRpcContext): AutomationRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const automationId = String(p.automationId ?? p.id ?? '').trim()
  if (!automationId) {
    return { error: { code: 'invalid_argument', message: 'automationId is required' } }
  }
  const existing = ctx.automations.get(automationId)
  if (!existing) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }
  const scopeProjectId = typeof p.projectId === 'string' ? p.projectId.trim() : ''
  if (scopeProjectId && scopeProjectId !== existing.projectId) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }

  const patch: UpdateAutomationRequest = {}
  if (typeof p.name === 'string') patch.name = p.name
  if (typeof p.prompt === 'string') patch.prompt = p.prompt
  if (typeof p.enabled === 'boolean') patch.enabled = p.enabled
  if (p.agentConfig !== undefined) {
    const agentConfig = parseAgentConfig(p.agentConfig)
    if (!agentConfig) {
      return { error: { code: 'invalid_argument', message: 'agentConfig.type must be claude, codex, acp, or opencode' } }
    }
    patch.agentConfig = agentConfig
  }
  if (p.schedule !== undefined) {
    const schedule = parseSchedule(p.schedule)
    if (!schedule) {
      return { error: { code: 'invalid_argument', message: 'schedule.type must be one-time or recurring' } }
    }
    patch.schedule = schedule
  }

  try {
    const row = ctx.automations.update(automationId, patch)
    if (!row) {
      return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
    }
    return { result: { automation: toNodeAutomation(row) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAutomationDelete(payload: unknown, ctx: AutomationRpcContext): AutomationRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const automationId = String(p.automationId ?? p.id ?? '').trim()
  if (!automationId) {
    return { error: { code: 'invalid_argument', message: 'automationId is required' } }
  }
  const existing = ctx.automations.get(automationId)
  if (!existing) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }
  const scopeProjectId = typeof p.projectId === 'string' ? p.projectId.trim() : ''
  if (scopeProjectId && scopeProjectId !== existing.projectId) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }
  try {
    const ok = ctx.automations.delete(automationId)
    if (!ok) {
      return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
    }
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}

export async function handleAutomationRunNow(
  payload: unknown,
  ctx: AutomationRpcContext,
): Promise<AutomationRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const automationId = String(p.automationId ?? p.id ?? '').trim()
  if (!automationId) {
    return { error: { code: 'invalid_argument', message: 'automationId is required' } }
  }
  const existing = ctx.automations.get(automationId)
  if (!existing) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }
  const scopeProjectId = typeof p.projectId === 'string' ? p.projectId.trim() : ''
  if (scopeProjectId && scopeProjectId !== existing.projectId) {
    return { error: { code: 'not_found', message: `automation not found: ${automationId}` } }
  }
  try {
    const result = await ctx.automationService.runNow(automationId)
    return {
      result: {
        automationId,
        status: result.status,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Route automation.* methods. Returns null if method is not an automation method. */
export function dispatchAutomationRpc(
  method: string,
  payload: unknown,
  ctx: AutomationRpcContext,
): AutomationRpcResult | Promise<AutomationRpcResult> | null {
  switch (method) {
    case 'automation.list':
      return handleAutomationList(payload, ctx)
    case 'automation.create':
      return handleAutomationCreate(payload, ctx)
    case 'automation.update':
      return handleAutomationUpdate(payload, ctx)
    case 'automation.delete':
      return handleAutomationDelete(payload, ctx)
    case 'automation.runNow':
      return handleAutomationRunNow(payload, ctx)
    default:
      return null
  }
}

export const AUTOMATION_MUTATING_METHODS = [
  'automation.create',
  'automation.update',
  'automation.delete',
  'automation.runNow',
] as const
