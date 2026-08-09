import {
  CONFIG_APPLY_FIELD,
  type ConfigConfirmField,
  type ConfigConfirmPayload,
  type ConfigFieldContext,
  type ConfigFieldType,
} from '@superone/shared/agent-types'
import log from '../logger'
import { readAppSettings } from '../app-settings-service'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import {
  buildDomainGuide,
  buildPatchFromValues,
  listDomainSummaries,
  toConfirmFields,
  validateChanges,
} from './settings-registry'
import {
  findResourceDef,
  listResourceSummaries,
  readResourceField,
  resourceContext,
  type ResourceDef,
  type ResourceFieldDef,
} from './resource-registry'
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

type ConfirmOutcome = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }

// Matches the collaboration confirm window — a settings dialog is reviewed by a human, and the
// shorter window used to fire while the user was still reading it.
const CONFIG_CONFIRM_TIMEOUT_MS = 10 * 60_000

const configConfirms = new HostConfirmRegistry<ConfirmOutcome>({
  idPrefix: 'configconfirm',
  timeoutMs: CONFIG_CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Settings confirmation timed out after ${CONFIG_CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveConfigConfirm(requestId: string, action: string, content?: Record<string, unknown>): boolean {
  return configConfirms.settle(requestId, action === 'accept', {
    action: action as ConfirmOutcome['action'],
    content,
  })
}

export function rejectConfigConfirm(requestId: string, reason: string): boolean {
  return configConfirms.fail(requestId, new Error(reason))
}

async function awaitConfigConfirm(session: SessionTitleSetter, message: string, payload: ConfigConfirmPayload): Promise<ConfirmOutcome> {
  return configConfirms.open(session, (requestId) => {
    log.info('[config-tools] opening config confirm requestId=%s', requestId)
    return {
      requestId,
      toolName: 'config_apply',
      toolUseId: requestId,
      input: {} as Record<string, unknown>,
      allowAlwaysAllow: false,
      requestKind: 'config_confirm' as const,
      serverName: 'superone',
      message,
      configConfirm: payload,
    }
  })
}

/**
 * Structured field types carry their value as a plain object all the way to the confirm dialog, which
 * renders the same editor the settings page uses for them. Only `json` — the untyped escape hatch —
 * degrades to pretty-printed text, since there is nothing better to render it with.
 */
function toFieldValue(type: ConfigFieldType, raw: unknown): unknown {
  if (raw === undefined) return null
  if (type !== 'json') return raw
  if (raw === null || typeof raw === 'string') return raw
  return JSON.stringify(raw, null, 2)
}

function toResourceConfirmField(
  resource: string,
  def: ResourceFieldDef,
  ctx: ConfigFieldContext,
  currentRaw: unknown,
  proposedRaw: unknown,
): ConfigConfirmField {
  return {
    key: def.key,
    domain: resource,
    label: def.label,
    type: def.type,
    ...(def.enumValues ? { enumValues: [...def.enumValues] } : {}),
    ...(def.secret ? { secret: true } : {}),
    ...(def.note ? { note: def.note } : {}),
    context: ctx,
    currentValue: toFieldValue(def.type, currentRaw),
    proposedValue: toFieldValue(def.type, proposedRaw),
  }
}

function findRecordById(resourceDef: ResourceDef, projectPath: string, recordId: string): unknown | null {
  return resourceDef.list(projectPath).find((r) => (r as { id?: string }).id === recordId) ?? null
}

/** Fields the agent may send for an operation — selectors feed the context, createOnly fields are create-time. */
function editableFields(resourceDef: ResourceDef, operation: 'create' | 'update'): ResourceFieldDef[] {
  return resourceDef.fields.filter((f) => !f.selector && (operation === 'create' || !f.createOnly))
}

function unknownValueKeys(resourceDef: ResourceDef, operation: 'create' | 'update', values: Record<string, unknown>): string[] {
  const allowed = new Set([...editableFields(resourceDef, operation).map((f) => f.key), ...resourceDef.fields.filter((f) => f.selector).map((f) => f.key)])
  return Object.keys(values).filter((k) => !allowed.has(k))
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
  const values = req.values ?? {}
  if (req.operation !== 'delete') {
    const unknownKeys = unknownValueKeys(resourceDef, req.operation, values)
    if (unknownKeys.length) {
      return toolResult({
        status: 'error',
        message: `Unknown ${req.resource} field(s) for ${req.operation}: ${unknownKeys.join(', ')}`,
        availableFields: editableFields(resourceDef, req.operation).map((f) => f.key),
      })
    }
  }
  if (req.operation === 'create') {
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

  let existing: unknown = null
  if (req.operation === 'delete' || req.operation === 'update') {
    existing = findRecordById(resourceDef, projectPath, req.recordId!)
    if (!existing) return toolResult({ status: 'error', message: `No ${req.resource} found with id "${req.recordId}"` })
  }

  const ctx = resourceContext(resourceDef, existing, values)
  const identity = existing ? resourceDef.identifyBy(existing) : null
  const title = identity?.title ?? (typeof values.name === 'string' ? values.name : `New ${resourceDef.label}`)
  const subtitle = identity?.subtitle

  let confirmFields: ConfigConfirmField[] = []
  if (req.operation !== 'delete') {
    try {
      confirmFields = editableFields(resourceDef, req.operation)
        .filter((f) => f.key in values)
        .map((f) =>
          toResourceConfirmField(
            req.resource,
            f,
            ctx,
            existing ? readResourceField(resourceDef, existing, f.key, ctx) : undefined,
            values[f.key],
          ),
        )
    } catch (error) {
      return toolResult({ status: 'error', message: `Cannot read current ${req.resource} values: ${error instanceof Error ? error.message : String(error)}` })
    }
    if (confirmFields.length === 0) {
      return toolResult({ status: 'error', message: `No known ${req.resource} fields were provided in \`values\`.`, availableFields: editableFields(resourceDef, req.operation).map((f) => f.key) })
    }
  }

  const payload: ConfigConfirmPayload = {
    resource: { resource: req.resource, operation: req.operation, recordId: req.recordId, title, subtitle, context: ctx, fields: confirmFields },
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
    type: f.type,
    oldValue: f.currentValue,
    newValue: f.key in finalValues ? finalValues[f.key] : f.proposedValue,
  }))

  try {
    if (req.operation === 'delete') {
      const ok = resourceDef.delete(req.recordId!)
      if (!ok) return toolResult({ status: 'error', message: `Failed to delete ${req.resource} "${req.recordId}" — it may have already been removed.` })
      return toolResult({ status: 'applied', operation: 'delete', resource: req.resource, resourceLabel: resourceDef.label, recordId: req.recordId, title })
    }
    // Selectors never reach the dialog, so re-derive the context from the agent's values plus the
    // user's edits — the user may have retargeted a change by editing e.g. the platform it lands on.
    const finalCtx = resourceContext(resourceDef, existing, { ...values, ...finalValues })
    if (req.operation === 'update') {
      const updated = resourceDef.update(req.recordId!, finalValues, finalCtx)
      if (!updated) return toolResult({ status: 'error', message: `Failed to update ${req.resource} "${req.recordId}" — it may have been removed.` })
      return toolResult({ status: 'applied', operation: 'update', resource: req.resource, resourceLabel: resourceDef.label, title, applied: resourceChanges, record: resourceDef.toRecordSummary(updated) })
    }
    const created = resourceDef.create(projectPath, finalValues, finalCtx)
    return toolResult({ status: 'applied', operation: 'create', resource: req.resource, resourceLabel: resourceDef.label, title, applied: resourceChanges, record: resourceDef.toRecordSummary(created) })
  } catch (error) {
    return toolResult({ status: 'error', message: `Failed to ${req.operation} ${req.resource}: ${error instanceof Error ? error.message : String(error)}` })
  }
}

export function configReadHandler(args: { domain?: string; recordId?: string }, deps: BuiltInSuperoneToolDeps) {
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
    const records = resourceDef.list(projectPath)
    // The record list stays an identity index: a full dump of every record's nested structure is what
    // pushed the agent towards re-sending whole configurations. One record is read on demand instead.
    if (args.recordId) {
      const record = records.find((r) => (r as { id?: string }).id === args.recordId)
      if (!record) {
        return toolResult({ status: 'error', message: `No ${resourceDef.resource} found with id "${args.recordId}"`, recordIds: records.map((r) => (r as { id?: string }).id) })
      }
      const ctx = resourceContext(resourceDef, record, {})
      return toolResult({
        resource: resourceDef.resource,
        label: resourceDef.label,
        record: resourceDef.toRecordSummary(record),
        ...(Object.keys(ctx).length ? { context: ctx } : {}),
        currentValues: Object.fromEntries(
          resourceDef.fields
            .filter((f) => !f.selector && !f.createOnly)
            .map((f) => [f.key, readResourceField(resourceDef, record, f.key, ctx)]),
        ),
      })
    }
    return toolResult({
      resource: resourceDef.resource,
      label: resourceDef.label,
      description: resourceDef.description,
      fields: resourceDef.fields,
      records: records.map((r) => ({ id: (r as { id?: string }).id, ...resourceDef.identifyBy(r) })),
      hint: 'Call config_read again with `recordId` to read one record\'s current values. When updating, send only the fields that change.',
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
      message: 'None of the proposed changes are valid. Call config_read for valid keys and values.',
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
