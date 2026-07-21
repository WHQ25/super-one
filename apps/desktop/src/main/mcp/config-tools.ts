import { CONFIG_APPLY_FIELD, type ConfigConfirmField, type ConfigConfirmPayload } from '@superone/shared/agent-types'
import log from '../logger'
import { readAppSettings } from '../app-settings-service'
import {
  buildDomainGuide,
  buildPatchFromValues,
  listDomainSummaries,
  toConfirmFields,
  validateChanges,
} from './settings-registry'
import { findResourceDef, listResourceSummaries, type ResourceDef, type ResourceFieldDef } from './resource-registry'
import type { BuiltInSuperoneToolDeps, SessionTitleSetter } from './superone-mcp-builtins'

export interface ConfigApplyArgs {
  changes?: Array<{ key: string; value: string | number | boolean | null }>
  resource?: {
    resource: string
    operation: 'create' | 'update' | 'delete'
    recordId?: string
    values?: Record<string, unknown>
  }
}

function currentProjectPath(deps: BuiltInSuperoneToolDeps): string | null {
  return deps.sessionHost?.getSession(deps.sessionId)?.projectPath ?? null
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

// --- HITL confirmation round-trip (mirrors media-tools' video-confirm flow) ---

const pendingConfigConfirms = new Map<string, {
  resolve: (value: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

const CONFIG_CONFIRM_TIMEOUT_MS = 120_000

export function resolveConfigConfirm(requestId: string, action: string, content?: Record<string, unknown>): boolean {
  const pending = pendingConfigConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingConfigConfirms.delete(requestId)
  pending.resolve({ action: action as 'accept' | 'decline' | 'cancel', content })
  return true
}

export function rejectConfigConfirm(requestId: string, reason: string): boolean {
  const pending = pendingConfigConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingConfigConfirms.delete(requestId)
  pending.reject(new Error(reason))
  return true
}

type ConfirmOutcome = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }

async function awaitConfigConfirm(session: SessionTitleSetter, message: string, payload: ConfigConfirmPayload): Promise<ConfirmOutcome> {
  const requestId = `configconfirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  log.info('[config-tools] opening config confirm requestId=%s', requestId)
  return new Promise<ConfirmOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConfigConfirms.delete(requestId)
      reject(new Error(`Settings confirmation timed out after ${CONFIG_CONFIRM_TIMEOUT_MS}ms`))
    }, CONFIG_CONFIRM_TIMEOUT_MS)
    pendingConfigConfirms.set(requestId, { resolve, reject, timer })

    session.emitHostEvent!({
      type: 'permission_request',
      request: {
        requestId,
        toolName: 'config_apply',
        toolUseId: requestId,
        input: {} as Record<string, unknown>,
        allowAlwaysAllow: false,
        requestKind: 'config_confirm' as const,
        serverName: 'superone',
        message,
        configConfirm: payload,
      },
    })
  })
}

function toDisplayValue(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return JSON.stringify(v, null, 2)
}

function toResourceConfirmField(resource: string, def: ResourceFieldDef, currentRaw: unknown, proposedRaw: unknown): ConfigConfirmField {
  return {
    key: def.key,
    domain: resource,
    label: def.label,
    type: def.type,
    ...(def.enumValues ? { enumValues: [...def.enumValues] } : {}),
    ...(def.note ? { note: def.note } : {}),
    currentValue: toDisplayValue(currentRaw),
    proposedValue: toDisplayValue(proposedRaw),
  }
}

function findRecordById(resourceDef: ResourceDef, projectPath: string, recordId: string): Record<string, unknown> | null {
  const record = resourceDef.list(projectPath).find((r) => (r as { id?: string }).id === recordId)
  return record ? (resourceDef.toRecordSummary(record) as Record<string, unknown>) : null
}

async function applyResourceChange(req: NonNullable<ConfigApplyArgs['resource']>, deps: BuiltInSuperoneToolDeps) {
  const resourceDef = findResourceDef(req.resource)
  if (!resourceDef) {
    return toolResult({
      status: 'error',
      message: `Unknown resource: ${req.resource}`,
      availableResources: listResourceSummaries().map((r) => r.domain),
    })
  }
  if ((req.operation === 'update' || req.operation === 'delete') && !req.recordId) {
    return toolResult({ status: 'error', message: `\`recordId\` is required for operation "${req.operation}"` })
  }
  if (req.operation === 'create') {
    const values = req.values ?? {}
    const missing = resourceDef.fields.filter((f) => f.required && !(f.key in values)).map((f) => f.key)
    if (missing.length) return toolResult({ status: 'error', message: `Missing required fields for ${req.resource} create: ${missing.join(', ')}` })
  }

  let projectPath = ''
  if (resourceDef.projectScoped !== false) {
    const p = currentProjectPath(deps)
    if (!p) {
      return toolResult({ status: 'error', message: 'No active project for this session — resource domains are project-scoped.' })
    }
    projectPath = p
  }

  const session = deps.sessionHost?.getSession(deps.sessionId) ?? null
  if (!session?.emitHostEvent) {
    return toolResult({
      status: 'error',
      message: 'Resource changes require a confirmation dialog, but the session is not available. Nothing was changed.',
      hint: 'Do NOT retry config_apply — it will fail the same way. Report the error to the user.',
    })
  }

  let title: string
  let subtitle: string | undefined
  let confirmFields: ConfigConfirmField[]
  let existing: Record<string, unknown> | null = null

  if (req.operation === 'delete' || req.operation === 'update') {
    existing = findRecordById(resourceDef, projectPath, req.recordId!)
    if (!existing) return toolResult({ status: 'error', message: `No ${req.resource} found with id "${req.recordId}"` })
  }

  if (req.operation === 'delete') {
    const identity = resourceDef.identifyBy(existing)
    title = identity.title
    subtitle = identity.subtitle
    confirmFields = []
  } else if (req.operation === 'update') {
    const identity = resourceDef.identifyBy(existing)
    title = identity.title
    subtitle = identity.subtitle
    const values = req.values ?? {}
    confirmFields = resourceDef.fields
      .filter((f) => f.key in values)
      .map((f) => toResourceConfirmField(req.resource, f, existing![f.key], values[f.key]))
  } else {
    const values = req.values ?? {}
    title = typeof values.name === 'string' ? values.name : `New ${resourceDef.label}`
    subtitle = undefined
    confirmFields = resourceDef.fields
      .filter((f) => f.key in values)
      .map((f) => toResourceConfirmField(req.resource, f, undefined, values[f.key]))
  }

  const payload: ConfigConfirmPayload = {
    resource: { resource: req.resource, operation: req.operation, recordId: req.recordId, title, subtitle, fields: confirmFields },
  }

  let result: ConfirmOutcome
  try {
    result = await awaitConfigConfirm(session, `Confirm ${req.operation} ${resourceDef.label}: ${title}`, payload)
  } catch (error) {
    return toolResult({
      status: 'error',
      message: `Confirmation failed: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`,
      hint: 'Do NOT retry config_apply — report the error to the user.',
    })
  }

  if (result.action === 'cancel') {
    return toolResult({ status: 'cancelled', hint: 'The user dismissed the confirmation without choosing. Do NOT retry on your own — wait for further instructions.' })
  }
  if (result.action === 'decline') {
    const feedback = typeof result.content?.feedback === 'string' ? result.content.feedback : ''
    return toolResult({
      status: 'rejected',
      ...(feedback ? { feedback } : {}),
      hint: `The user rejected this ${req.operation}. Adjust according to the feedback, or ask the user before trying again.`,
    })
  }

  // accept — the user may have edited values in the dialog; re-parse json-typed fields.
  let finalValues: Record<string, unknown> = {}
  const raw = result.content?.[CONFIG_APPLY_FIELD]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') finalValues = parsed as Record<string, unknown>
    } catch {
      // fall through to the originally proposed values
    }
  }
  if (Object.keys(finalValues).length === 0) {
    finalValues = Object.fromEntries(confirmFields.map((f) => [f.key, f.proposedValue]))
  }
  for (const field of confirmFields) {
    if (field.type !== 'json') continue
    const raw = finalValues[field.key]
    if (typeof raw !== 'string') continue
    try {
      finalValues[field.key] = JSON.parse(raw)
    } catch {
      return toolResult({ status: 'error', message: `\`${field.key}\` is not valid JSON. Nothing was changed.` })
    }
  }

  const resourceChanges = confirmFields.map((f) => ({
    key: f.key,
    label: f.label,
    oldValue: f.currentValue,
    newValue: toDisplayValue(f.key in finalValues ? finalValues[f.key] : f.proposedValue),
  }))

  try {
    if (req.operation === 'delete') {
      const ok = resourceDef.delete(req.recordId!)
      if (!ok) return toolResult({ status: 'error', message: `Failed to delete ${req.resource} "${req.recordId}" — it may have already been removed.` })
      return toolResult({ status: 'applied', operation: 'delete', resource: req.resource, resourceLabel: resourceDef.label, recordId: req.recordId, title })
    }
    if (req.operation === 'update') {
      const updated = resourceDef.update(req.recordId!, finalValues)
      if (!updated) return toolResult({ status: 'error', message: `Failed to update ${req.resource} "${req.recordId}" — it may have been removed.` })
      return toolResult({ status: 'applied', operation: 'update', resource: req.resource, resourceLabel: resourceDef.label, title, applied: resourceChanges, record: resourceDef.toRecordSummary(updated) })
    }
    const created = resourceDef.create(projectPath, finalValues)
    return toolResult({ status: 'applied', operation: 'create', resource: req.resource, resourceLabel: resourceDef.label, title, applied: resourceChanges, record: resourceDef.toRecordSummary(created) })
  } catch (error) {
    return toolResult({ status: 'error', message: `Failed to ${req.operation} ${req.resource}: ${error instanceof Error ? error.message : String(error)}` })
  }
}

export function configReadGuideHandler(args: { domain?: string }, deps: BuiltInSuperoneToolDeps) {
  if (!args.domain) {
    return toolResult({ domains: [...listDomainSummaries(), ...listResourceSummaries()] })
  }

  const resourceDef = findResourceDef(args.domain)
  if (resourceDef) {
    let projectPath = ''
    if (resourceDef.projectScoped !== false) {
      const p = currentProjectPath(deps)
      if (!p) {
        return toolResult({ status: 'error', message: 'No active project for this session — resource domains are project-scoped.' })
      }
      projectPath = p
    }
    return toolResult({
      resource: resourceDef.resource,
      label: resourceDef.label,
      description: resourceDef.description,
      fields: resourceDef.fields,
      records: resourceDef.list(projectPath).map((r) => resourceDef.toRecordSummary(r)),
    })
  }

  const settings = readAppSettings()
  const guide = buildDomainGuide(args.domain, settings)
  if (!guide) {
    return toolResult({
      status: 'error',
      message: `Unknown settings domain: ${args.domain}`,
      availableDomains: [...listDomainSummaries(), ...listResourceSummaries()].map((d) => d.domain),
    })
  }
  return toolResult(guide)
}

export async function configApplyHandler(args: ConfigApplyArgs, deps: BuiltInSuperoneToolDeps) {
  if (args.resource) return applyResourceChange(args.resource, deps)

  const changes = Array.isArray(args.changes) ? args.changes : []
  if (changes.length === 0) {
    return toolResult({ status: 'error', message: 'No changes provided. Pass a non-empty `changes` array.' })
  }

  const settings = readAppSettings()
  const { valid, rejected } = validateChanges(changes, settings)
  if (valid.length === 0) {
    return toolResult({
      status: 'error',
      message: 'None of the proposed changes are valid. Call config_read_guide for valid keys and values.',
      rejected,
    })
  }

  const session = deps.sessionHost?.getSession(deps.sessionId) ?? null
  if (!session?.emitHostEvent) {
    return toolResult({
      status: 'error',
      message: 'Settings changes require a confirmation dialog, but the session is not available. Nothing was changed.',
      hint: 'Do NOT retry config_apply — it will fail the same way. Report the error to the user.',
    })
  }

  const fieldCount = valid.length
  const payload: ConfigConfirmPayload = { fields: toConfirmFields(valid) }

  let result: ConfirmOutcome
  try {
    result = await awaitConfigConfirm(session, `Confirm ${fieldCount} settings change${fieldCount === 1 ? '' : 's'}`, payload)
  } catch (error) {
    return toolResult({
      status: 'error',
      message: `Settings confirmation failed: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`,
      hint: 'Do NOT retry config_apply — report the error to the user.',
    })
  }

  if (result.action === 'cancel') {
    return toolResult({
      status: 'cancelled',
      hint: 'The user dismissed the confirmation without choosing. Do NOT retry on your own — wait for further instructions.',
    })
  }
  if (result.action === 'decline') {
    const feedback = typeof result.content?.feedback === 'string' ? result.content.feedback : ''
    return toolResult({
      status: 'rejected',
      ...(feedback ? { feedback } : {}),
      hint: 'The user rejected these settings changes. Adjust according to the feedback, or ask the user before trying again.',
    })
  }

  // accept — the user may have edited values in the dialog; re-validate them.
  let finalValues: Record<string, unknown> = {}
  const configJson = result.content?.[CONFIG_APPLY_FIELD]
  if (typeof configJson === 'string') {
    try {
      const parsed = JSON.parse(configJson)
      if (parsed && typeof parsed === 'object') finalValues = parsed as Record<string, unknown>
    } catch {
      // fall through to proposed values
    }
  }
  if (Object.keys(finalValues).length === 0) {
    finalValues = Object.fromEntries(valid.map((v) => [v.field.key, v.proposedValue]))
  }

  const fresh = readAppSettings()
  const { patch, applied, rejected: applyRejected } = buildPatchFromValues(finalValues, fresh)
  if (applied.length === 0) {
    return toolResult({ status: 'error', message: 'No valid changes remained after user edits.', rejected: applyRejected })
  }

  try {
    await deps.applyAppSettings(patch)
  } catch (error) {
    return toolResult({
      status: 'error',
      message: `Failed to apply settings: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  const allRejected = [...rejected, ...applyRejected]
  return toolResult({
    status: 'applied',
    applied,
    ...(allRejected.length ? { rejected: allRejected } : {}),
  })
}
