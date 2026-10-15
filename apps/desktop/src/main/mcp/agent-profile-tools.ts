/**
 * SuperOne MCP agent profile tools:
 * agent_profile_list / agent_profile_apply / agent_profile_delete
 *
 * A profile is a non-base `session_providers` row carrying `config.profile`
 * (`@superone/shared/agent-profile`). Every write is approved by the user
 * through a HostConfirmRegistry prompt; built-in `<harness>-base` rows are
 * read-only here.
 */

import { encode as toonEncode } from '@toon-format/toon'
import type {
  AgentProfileConfirmChange,
  AgentProfileConfirmPayload,
  AgentProfileConfirmView,
  AgentProfileRuntimeField,
  HarnessId,
} from '@superone/shared/agent-types'
import {
  AGENT_PROFILE_VERSION,
  parseAgentProfileSpec,
  providerLaunchRuntime,
  readAgentProfile,
  type AgentProfileCatalog,
  type AgentProfileRuntime,
  type AgentProfileSpec,
} from '@superone/shared/agent-profile'
import {
  agentProfileOptionChoices,
  HARNESS_PROFILE_OPTIONS,
  isModelBoundOption,
  optionDisplayValue,
  type AgentProfileOptionChoices,
  type AgentProfileOptionKey,
  type AgentProfileOptions,
} from '@superone/shared/agent-profile-options'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import log from '../logger'
import { isProviderUsable, profileResources, resolveAcpAgentId } from '../session/agent-profiles'
import { profileConfirms, type ConfirmOutcome } from './agent-profile-confirm'
import {
  agentProfileCatalog,
  agentProfileCatalogError,
  agentProfileNameTaken,
  createAgentProfile,
  deleteAgentProfile,
  harnessDisplayName,
  updateAgentProfile,
} from '../session/agent-profile-store'
import { getBaseProvider, getSessionProvider, listSessionProviders } from '../session/session-provider-repo'
import type { SessionProvider } from '../session/types'
import type { BuiltInSuperoneToolDeps, SessionTitleSetter } from './superone-mcp-builtins'

export const AGENT_PROFILE_DELETE_MAX = 20
const DESCRIPTION_PREVIEW = 120
function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function errorResult(message: string) {
  return toolResult({ status: 'error', message }, true)
}

const HARNESS_IDS = Object.keys(HARNESS_CAPABILITIES) as HarnessId[]

function builtInDescription(row: SessionProvider): string {
  return `${harnessDisplayName(row.harnessId)} with the user's default configuration.`
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= DESCRIPTION_PREVIEW ? oneLine : `${oneLine.slice(0, DESCRIPTION_PREVIEW)}…`
}

function rowAcpAgentId(row: SessionProvider): string | null {
  return row.harnessId === 'acp' ? resolveAcpAgentId(row) : null
}

// ─── Views ───

type OptionChoices = Partial<Record<AgentProfileOptionKey, AgentProfileOptionChoices | null>>

function findModel(catalog: AgentProfileCatalog, model: string | undefined) {
  return model ? catalog.models.find((option) => option.id === model) : undefined
}

function modelName(catalog: AgentProfileCatalog, model: string | undefined): string | undefined {
  const name = (findModel(catalog, model) as { name?: string } | undefined)?.name
  return name && name !== model ? name : undefined
}

/** The harness's options for the profile's model (any model when it names none). */
function optionChoicesFor(harnessId: HarnessId, catalog: AgentProfileCatalog, model: string | undefined): OptionChoices {
  const found = findModel(catalog, model)
  return agentProfileOptionChoices(harnessId, found ? [found] : catalog.models, catalog.host)
}

/** Fields no model this view could launch on supports — shown as explicit "not supported" rows. */
function unsupportedFields(harnessId: HarnessId, catalog: AgentProfileCatalog, model: string | undefined): AgentProfileRuntimeField[] {
  // An uncached catalog proves nothing about model-bound fields; do not claim them unsupported.
  const uncached = catalog.models.length === 0
  const found = findModel(catalog, model)
  const unsupported: AgentProfileRuntimeField[] = []
  const efforts = (found ? [found] : catalog.models).some((option) =>
    (option.supportedEffortLevels?.length ?? 0) > 0 || (option.supportedReasoningEfforts?.length ?? 0) > 0)
  if (!uncached && !efforts && !catalog.efforts?.length) unsupported.push('effort')
  const choices = optionChoicesFor(harnessId, catalog, model)
  for (const key of HARNESS_PROFILE_OPTIONS[harnessId]) {
    if (choices[key] === null && !(uncached && isModelBoundOption(key))) unsupported.push(key)
  }
  return unsupported
}

function optionLabels(options: AgentProfileOptions | undefined, choices: OptionChoices): Partial<Record<AgentProfileOptionKey, string>> {
  return Object.fromEntries(Object.entries(options ?? {}).map(([key, value]) =>
    [key, optionDisplayValue(key as AgentProfileOptionKey, value, choices[key as AgentProfileOptionKey])]))
}

function toView(
  input: { id?: string; harnessId: HarnessId; acpAgentId?: string | null; spec: AgentProfileSpec },
  catalog: AgentProfileCatalog,
): AgentProfileConfirmView {
  const { spec } = input
  const runtime = spec.runtime ?? {}
  const unsupported = unsupportedFields(input.harnessId, catalog, runtime.model)
  const name = modelName(catalog, runtime.model)
  const options = optionLabels(runtime.options, optionChoicesFor(input.harnessId, catalog, runtime.model))
  return {
    ...(input.id ? { id: input.id } : {}),
    harnessId: input.harnessId,
    ...(input.acpAgentId ? { acpAgentId: input.acpAgentId } : {}),
    name: spec.identity.name,
    description: spec.identity.description,
    ...(spec.instructions ? { instructions: spec.instructions } : {}),
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(name ? { modelName: name } : {}),
    ...(runtime.effort ? { effort: runtime.effort } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(unsupported.length ? { unsupported } : {}),
  }
}

function fieldText(spec: AgentProfileSpec, field: AgentProfileConfirmChange['field'], choices: OptionChoices): string {
  const runtime = spec.runtime ?? {}
  switch (field) {
    case 'name': return spec.identity.name
    case 'description': return spec.identity.description
    case 'instructions': return spec.instructions ?? ''
    case 'model': return runtime.model ?? ''
    case 'effort': return runtime.effort ?? ''
    default: {
      const value = runtime.options?.[field]
      return value === undefined ? '' : optionDisplayValue(field, value, choices[field])
    }
  }
}

function diffSpecs(
  harnessId: HarnessId,
  catalog: AgentProfileCatalog,
  before: AgentProfileSpec,
  after: AgentProfileSpec,
): AgentProfileConfirmChange[] {
  const fields: AgentProfileConfirmChange['field'][] = [
    'name', 'description', 'instructions', 'model', 'effort', ...HARNESS_PROFILE_OPTIONS[harnessId],
  ]
  const beforeChoices = optionChoicesFor(harnessId, catalog, before.runtime?.model)
  const afterChoices = optionChoicesFor(harnessId, catalog, after.runtime?.model)
  return fields.flatMap((field) => {
    const from = fieldText(before, field, beforeChoices)
    const to = fieldText(after, field, afterChoices)
    return from === to ? [] : [{ field, ...(from ? { from } : {}), ...(to ? { to } : {}) }]
  })
}

function summarizeConfirm(payload: AgentProfileConfirmPayload): string {
  const names = payload.profiles.map((profile) => profile.name).join(', ')
  if (payload.operation === 'delete') return `Permanently delete agent profile(s): ${names}?`
  if (payload.operation === 'create') return `Create agent profile "${names}"?`
  const lines = (payload.changes ?? []).map((change) => `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`)
  return [`Update agent profile "${names}"?`, ...lines].join('\n')
}

async function awaitConfirm(
  session: SessionTitleSetter,
  opts: {
    toolName: 'mcp__superone__agent_profile_apply' | 'mcp__superone__agent_profile_delete'
    payload: AgentProfileConfirmPayload
    input: Record<string, unknown>
    riskLevel: 'medium' | 'high'
    abortErrorMessage: string
    signal?: AbortSignal
  },
): Promise<ConfirmOutcome> {
  return profileConfirms.open(
    session,
    (requestId) => ({
      requestId,
      toolName: opts.toolName,
      toolUseId: requestId,
      input: opts.input,
      // A profile is a standing permission boundary: never a permanent opt-out.
      allowAlwaysAllow: false,
      serverName: 'superone',
      requestKind: 'agent_profile_confirm',
      agentProfileConfirm: opts.payload,
      message: summarizeConfirm(opts.payload),
      subtitle: opts.payload.profiles.map((profile) => profile.name).slice(0, 8).join(', '),
      riskLevel: opts.riskLevel,
    }),
    { signal: opts.signal, abortError: () => new Error(opts.abortErrorMessage) },
  )
}

function requireConfirmSession(deps: BuiltInSuperoneToolDeps): { session: SessionTitleSetter } | { error: ReturnType<typeof toolResult> } {
  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.emitHostEvent) return { error: errorResult('Cannot open confirmation: current session host is unavailable.') }
  return { session }
}

/** Decline / cancel / timeout are neutral results: the model waits for the user rather than retrying. */
async function confirmOrRefusal(
  deps: BuiltInSuperoneToolDeps,
  opts: Omit<Parameters<typeof awaitConfirm>[1], 'signal'>,
): Promise<ReturnType<typeof toolResult> | null> {
  const host = requireConfirmSession(deps)
  if ('error' in host) return host.error
  let outcome: ConfirmOutcome
  try {
    outcome = await awaitConfirm(host.session, { ...opts, signal: deps.signal })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/timed out|cancelled/i.test(message)) return toolResult({ status: 'cancelled', message })
    return errorResult(message)
  }
  if (outcome.action === 'accept') {
    return deps.signal?.aborted ? toolResult({ status: 'cancelled', message: 'The tool call was cancelled.' }) : null
  }
  return toolResult({
    status: outcome.action === 'cancel' ? 'cancelled' : 'rejected',
    message: 'The user did not approve this change. Do not retry on your own; wait for the user.',
    ...(outcome.feedback ? { feedback: outcome.feedback } : {}),
  })
}

// ─── List ───

export interface AgentProfileListArgs {
  id?: string
}

function listRow(row: SessionProvider) {
  const spec = readAgentProfile(row.config)
  const runtime = providerLaunchRuntime(row.config) ?? {}
  return {
    id: row.id,
    name: row.name,
    harness: row.harnessId,
    base: row.isBase,
    available: isProviderUsable(row),
    description: preview(spec?.identity.description ?? (row.isBase ? builtInDescription(row) : '')),
    model: runtime.model ?? '',
    effort: runtime.effort ?? '',
    options: Object.entries(optionLabels(runtime.options, {})).map(([key, value]) => `${key}: ${value}`).join('; '),
  }
}

/** What an option accepts, as the authoring agent reads it: null = not supported. */
function choicesView(choices: AgentProfileOptionChoices | null | undefined) {
  if (!choices) return null
  switch (choices.kind) {
    case 'toggle': return 'boolean'
    case 'unlisted': return 'any (not listed yet)'
    case 'choice': return choices.values.map((choice) => choice.value)
    case 'params': return Object.fromEntries(choices.params.map((param) => [param.id, param.values.map((value) => value.value)]))
  }
}

/** Per model: its efforts and the model-bound options; harness-wide lists once at the top. */
function optionsView(harnessId: HarnessId, catalog: AgentProfileCatalog) {
  const keys = HARNESS_PROFILE_OPTIONS[harnessId]
  const harnessWide = agentProfileOptionChoices(harnessId, [], catalog.host)
  return {
    keys,
    harness: Object.fromEntries(keys.filter((key) => !isModelBoundOption(key)).map((key) => [key, choicesView(harnessWide[key])])),
    models: catalog.models.map((model) => {
      const name = (model as { name?: string }).name
      const choices = agentProfileOptionChoices(harnessId, [model], catalog.host)
      const efforts = model.supportedEffortLevels ?? model.supportedReasoningEfforts?.map((effort) => effort.value) ?? catalog.efforts ?? []
      return {
        id: model.id,
        ...(name && name !== model.id ? { name } : {}),
        efforts: [...efforts],
        options: Object.fromEntries(keys.filter(isModelBoundOption).map((key) => [key, choicesView(choices[key])])),
      }
    }),
  }
}

export async function agentProfileListHandler(args: AgentProfileListArgs) {
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (!id) {
    const profiles = listSessionProviders().map(listRow)
    return toolResult(toonEncode({ status: 'ok', count: profiles.length, profiles }))
  }
  const row = getSessionProvider(id)
  if (!row) return errorResult(`Agent profile not found: ${id}. Call agent_profile_list without id to discover ids.`)
  const spec = readAgentProfile(row.config)
  const catalog = await agentProfileCatalog(row)
  const launchDefaults = profileResources(row, { acpAgentId: rowAcpAgentId(row) }).defaultConfig
  const acpAgentId = rowAcpAgentId(row)
  return toolResult({
    status: 'ok',
    profile: {
      id: row.id,
      name: row.name,
      harnessId: row.harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      base: row.isBase,
      available: isProviderUsable(row),
      description: spec?.identity.description ?? (row.isBase ? builtInDescription(row) : ''),
      instructions: spec?.instructions ?? '',
      runtime: providerLaunchRuntime(row.config) ?? {},
    },
    launchDefaults,
    available: optionsView(row.harnessId, catalog),
    ...(row.isBase ? { note: 'Built-in agent: read-only. Create a profile on this harness to customize it.' } : {}),
  })
}

// ─── Apply ───

export interface AgentProfileApplyArgs {
  action: 'create' | 'update'
  id?: string
  harnessId?: string
  name?: string
  description?: string
  instructions?: string
  model?: string
  effort?: string
  /** The harness's own settings; `null` clears one. */
  options?: Partial<Record<AgentProfileOptionKey, unknown>>
}

/**
 * Lay the call's runtime fields over `base`. An empty string clears model or
 * effort, a `null` option clears that option. Options that belong to a model
 * are dropped when the model changes, unless the call sets them again.
 */
function mergeRuntime(base: AgentProfileRuntime | undefined, args: AgentProfileApplyArgs): AgentProfileRuntime | undefined {
  const next: AgentProfileRuntime = { ...base }
  const options: Record<string, unknown> = { ...base?.options }
  if (typeof args.model === 'string') {
    const model = args.model.trim()
    if (model !== base?.model) {
      for (const key of Object.keys(options)) if (isModelBoundOption(key as AgentProfileOptionKey)) delete options[key]
    }
    if (model) next.model = model
    else delete next.model
  }
  if (typeof args.effort === 'string') {
    if (args.effort.trim()) next.effort = args.effort.trim()
    else delete next.effort
  }
  for (const [key, value] of Object.entries(args.options ?? {})) {
    if (value === null) delete options[key]
    else if (value !== undefined) options[key] = value
  }
  if (Object.keys(options).length) next.options = options as AgentProfileOptions
  else delete next.options
  return Object.keys(next).length ? next : undefined
}

function buildSpec(
  harnessId: HarnessId,
  identity: { name: string; description: string },
  instructions: string | undefined,
  runtime: AgentProfileRuntime | undefined,
): { spec: AgentProfileSpec } | { error: string } {
  const parsed = parseAgentProfileSpec({
    version: AGENT_PROFILE_VERSION,
    identity,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(runtime ? { runtime } : {}),
  }, harnessId)
  return parsed.ok ? { spec: parsed.value } : { error: parsed.error.replace(/^profile\./, '') }
}

/** A write that failed after the user confirmed; a row changed meanwhile must be reviewed again. */
function writeFailed(action: 'create' | 'update', err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  log.warn('[agent_profile_apply] %s failed: %s', action, message)
  if ((err as { code?: unknown })?.code === 'aborted') {
    return errorResult(`${message} Nothing was saved. Call agent_profile_list for its current state and apply again.`)
  }
  return errorResult(message)
}

/** A legacy row's runtime, with only the options its harness has. */
function harnessRuntime(harnessId: HarnessId, runtime: AgentProfileRuntime | undefined): AgentProfileRuntime | undefined {
  if (!runtime?.options) return runtime
  const keys = HARNESS_PROFILE_OPTIONS[harnessId]
  const options = Object.fromEntries(Object.entries(runtime.options).filter(([key]) => keys.includes(key as AgentProfileOptionKey)))
  const next: AgentProfileRuntime = { ...runtime }
  if (Object.keys(options).length) next.options = options
  else delete next.options
  return Object.keys(next).length ? next : undefined
}

function profileResultView(row: SessionProvider) {
  const spec = readAgentProfile(row.config)
  return {
    id: row.id,
    name: row.name,
    harnessId: row.harnessId,
    description: spec?.identity.description ?? '',
    hasInstructions: !!spec?.instructions,
    runtime: spec?.runtime ?? {},
  }
}

async function createProfile(args: AgentProfileApplyArgs, deps: BuiltInSuperoneToolDeps) {
  const harnessId = args.harnessId as HarnessId
  if (!HARNESS_IDS.includes(harnessId)) {
    return errorResult(`create requires harnessId, one of: ${HARNESS_IDS.join(', ')}.`)
  }
  const name = args.name?.trim() ?? ''
  const description = args.description?.trim() ?? ''
  if (!name || !description) return errorResult('create requires name and description (what this agent is for).')
  const taken = agentProfileNameTaken(name)
  if (taken) return errorResult(`An agent named "${name}" already exists (${taken.id}). Pick another name or update that one.`)

  const built = buildSpec(harnessId, { name, description }, args.instructions, mergeRuntime(undefined, args))
  if ('error' in built) return errorResult(built.error)
  // ACP is a container: pin the agent the user runs today, so the profile keeps its catalog.
  const acpAgentId = harnessId === 'acp' ? resolveAcpAgentId(getBaseProvider('acp')) : null
  const config = { ...(acpAgentId ? { agentId: acpAgentId } : {}), profile: built.spec }
  const draft: SessionProvider = { id: '', harnessId, name, isBase: false, config, createdAt: 0, updatedAt: 0 }
  const catalog = await agentProfileCatalog(draft)
  const invalid = agentProfileCatalogError(draft, catalog)
  if (invalid) return errorResult(invalid)

  const refusal = await confirmOrRefusal(deps, {
    toolName: 'mcp__superone__agent_profile_apply',
    payload: { operation: 'create', profiles: [toView({ harnessId, acpAgentId, spec: built.spec }, catalog)] },
    input: { action: 'create', harnessId, name },
    riskLevel: 'medium',
    abortErrorMessage: 'Agent profile create cancelled',
  })
  if (refusal) return refusal

  try {
    const created = await createAgentProfile({ harnessId, name, config })
    return toolResult({
      status: 'ok',
      action: 'create',
      profile: profileResultView(created),
      next: `Delegate with session_collab_request({ agentId: "${created.id}" }); the user can @-mention it as ${name}.`,
    })
  } catch (err) {
    return writeFailed('create', err)
  }
}

async function updateProfile(args: AgentProfileApplyArgs, deps: BuiltInSuperoneToolDeps) {
  const id = args.id?.trim() ?? ''
  if (!id) return errorResult('update requires id. Call agent_profile_list first to discover profile ids.')
  const row = getSessionProvider(id)
  if (!row) return errorResult(`Agent profile not found: ${id}. Call agent_profile_list without id to discover ids.`)
  if (row.isBase) {
    return errorResult(`${id} is a built-in agent and cannot be changed. Create a profile on ${row.harnessId} instead.`)
  }
  if (args.harnessId !== undefined && args.harnessId !== row.harnessId) {
    return errorResult(`harnessId is fixed at creation (${row.harnessId}). Create a new profile for another harness.`)
  }
  const existing = readAgentProfile(row.config)
  const name = args.name !== undefined ? args.name.trim() : row.name
  const description = args.description !== undefined ? args.description.trim() : existing?.identity.description ?? ''
  if (!description) return errorResult('This profile has no description yet; pass description (what this agent is for).')
  if (args.name !== undefined) {
    const taken = agentProfileNameTaken(name, row.id)
    if (taken) return errorResult(`An agent named "${name}" already exists (${taken.id}).`)
  }
  const instructions = args.instructions !== undefined ? args.instructions : existing?.instructions
  // A row from before profiles keeps the launch defaults it already had; the profile owns them from now on.
  const runtime = existing ? existing.runtime : harnessRuntime(row.harnessId, providerLaunchRuntime(row.config))
  const built = buildSpec(row.harnessId, { name, description }, instructions, mergeRuntime(runtime, args))
  if ('error' in built) return errorResult(built.error)
  const config = { ...(row.config as Record<string, unknown>), profile: built.spec }
  const next: SessionProvider = { ...row, name, config }
  const catalog = await agentProfileCatalog(next)
  const before = existing
    ?? { version: AGENT_PROFILE_VERSION, identity: { name: row.name, description: '' }, ...(runtime ? { runtime } : {}) }
  const changes = diffSpecs(row.harnessId, catalog, before, built.spec)
  if (changes.length === 0) return errorResult('Nothing to change: every field already has that value.')
  const invalid = agentProfileCatalogError(next, catalog)
  if (invalid) return errorResult(invalid)

  const refusal = await confirmOrRefusal(deps, {
    toolName: 'mcp__superone__agent_profile_apply',
    payload: {
      operation: 'update',
      profiles: [toView({ id: row.id, harnessId: row.harnessId, acpAgentId: rowAcpAgentId(row), spec: built.spec }, catalog)],
      changes,
    },
    input: { action: 'update', id, name },
    riskLevel: 'medium',
    abortErrorMessage: 'Agent profile update cancelled',
  })
  if (refusal) return refusal

  try {
    const updated = await updateAgentProfile(row, { name, config })
    return toolResult({ status: 'ok', action: 'update', profile: profileResultView(updated), changed: changes.map((c) => c.field) })
  } catch (err) {
    return writeFailed('update', err)
  }
}

export async function agentProfileApplyHandler(args: AgentProfileApplyArgs, deps: BuiltInSuperoneToolDeps) {
  if (args.action === 'create') return createProfile(args, deps)
  if (args.action === 'update') return updateProfile(args, deps)
  return errorResult('action must be "create" or "update". Use agent_profile_delete to remove profiles.')
}

// ─── Delete ───

export interface AgentProfileDeleteArgs {
  ids: string[]
}

export async function agentProfileDeleteHandler(args: AgentProfileDeleteArgs, deps: BuiltInSuperoneToolDeps) {
  const ids = [...new Set((Array.isArray(args.ids) ? args.ids : [])
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim()))]
  if (ids.length === 0) return errorResult('ids is required. Call agent_profile_list to find ids.')
  if (ids.length > AGENT_PROFILE_DELETE_MAX) {
    return errorResult(`At most ${AGENT_PROFILE_DELETE_MAX} profiles per delete call. Split into multiple calls.`)
  }

  const found: SessionProvider[] = []
  const notFound: string[] = []
  const builtIn: string[] = []
  for (const id of ids) {
    const row = getSessionProvider(id)
    if (!row) notFound.push(id)
    else if (row.isBase) builtIn.push(id)
    else found.push(row)
  }
  if (found.length === 0) {
    return toolResult({
      status: 'not_found',
      deleted: [],
      ...(notFound.length ? { notFound } : {}),
      ...(builtIn.length ? { builtIn } : {}),
      message: builtIn.length
        ? 'Built-in <harness>-base agents cannot be deleted.'
        : 'No matching agent profiles. Call agent_profile_list to refresh ids.',
    })
  }

  const refusal = await confirmOrRefusal(deps, {
    toolName: 'mcp__superone__agent_profile_delete',
    payload: {
      operation: 'delete',
      profiles: found.map((row) => {
        const spec = readAgentProfile(row.config)
          ?? { version: AGENT_PROFILE_VERSION, identity: { name: row.name, description: '' } }
        return toView({ id: row.id, harnessId: row.harnessId, acpAgentId: rowAcpAgentId(row), spec }, { models: [] })
      }),
    },
    input: { ids: found.map((row) => row.id) },
    riskLevel: 'high',
    abortErrorMessage: 'Agent profile delete cancelled',
  })
  if (refusal) return refusal

  const deleted: Array<{ id: string; name: string }> = []
  const failed: Array<{ id: string; name: string; error: string }> = []
  for (const row of found) {
    try {
      if (deleteAgentProfile(row, deps.sessionHost)) deleted.push({ id: row.id, name: row.name })
      else failed.push({ id: row.id, name: row.name, error: 'not found at delete time' })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[agent_profile_delete] failed id=%s: %s', row.id, error)
      failed.push({ id: row.id, name: row.name, error })
    }
  }
  const status = failed.length === 0 ? 'ok' : deleted.length === 0 ? 'error' : 'partial'
  return toolResult({
    status,
    deleted,
    ...(failed.length ? { failed } : {}),
    ...(notFound.length ? { notFound } : {}),
    ...(builtIn.length ? { builtIn } : {}),
  }, status === 'error')
}
