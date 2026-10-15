/**
 * Agent profile options: the session settings, beyond model and effort, that
 * each harness's own selector offers — and so what a profile on that harness
 * can preset. Which keys a harness has is data here; which values a given
 * model allows comes from the harness catalog, never from harness branches.
 */

import type { HarnessId, ModelOption } from './agent-types'
import { findCodexFastServiceTier } from './codex-fast-mode'
import { selectorCatalogParams, type SelectorCatalogParam } from './model-option-params'

export interface AgentProfileOptions {
  /** Claude: Ultracode, offered where the model has `xhigh` effort. */
  ultracode?: boolean
  /** Codex: the model's Fast service tier. */
  fastMode?: boolean
  /** ACP: one of the model's listed context windows (tokens). */
  contextWindow?: number
  /** ACP: a session mode the agent lists outside its efforts. */
  mode?: string
  /** OpenCode: native agent (build, plan, …). */
  agent?: string
  /** DeepSeek: agent preset. */
  agentPreset?: string
  /** Cursor: model parameters (fast, context, …) by parameter id. */
  modelParams?: Record<string, string>
}

export type AgentProfileOptionKey = keyof AgentProfileOptions

/** Each harness's options, in its selector's order. */
export const HARNESS_PROFILE_OPTIONS: Readonly<Record<HarnessId, readonly AgentProfileOptionKey[]>> = {
  claude: ['ultracode'],
  codex: ['fastMode'],
  acp: ['contextWindow', 'mode'],
  opencode: ['agent'],
  cursor: ['modelParams'],
  dsh: ['agentPreset'],
}

/** Options that belong to one model and are re-checked when the model changes. */
const MODEL_BOUND: ReadonlySet<AgentProfileOptionKey> = new Set(['ultracode', 'fastMode', 'contextWindow', 'modelParams'])

/** Options that only mean something for a chosen model. */
export const MODEL_REQUIRED_OPTIONS: ReadonlySet<AgentProfileOptionKey> = new Set(['contextWindow', 'modelParams'])

type OptionKind = 'boolean' | 'number' | 'string' | 'params'

const OPTION_KINDS: Readonly<Record<AgentProfileOptionKey, OptionKind>> = {
  ultracode: 'boolean',
  fastMode: 'boolean',
  contextWindow: 'number',
  mode: 'string',
  agent: 'string',
  agentPreset: 'string',
  modelParams: 'params',
}

export const AGENT_PROFILE_OPTION_KEYS = Object.keys(OPTION_KINDS) as AgentProfileOptionKey[]

export function isModelBoundOption(key: AgentProfileOptionKey): boolean {
  return MODEL_BOUND.has(key)
}

/** A harness-wide list (`mode`, `agent`, `agentPreset`), as the host knows it. */
export interface AgentProfileListChoice {
  value: string
  label: string
}

export type AgentProfileListOptionKey = 'mode' | 'agent' | 'agentPreset'

/** The model fields option support is read from — structural, so desktop and CLI catalogs both fit. */
export type OptionCatalogModel = Pick<ModelOption, 'serviceTiers' | 'contextWindows' | 'parameters'> & {
  id: string
  supportedEffortLevels?: readonly string[]
}

/** What one option allows for one model. */
export type AgentProfileOptionChoices =
  | { kind: 'toggle' }
  | { kind: 'choice'; values: Array<{ value: string | number; label: string }> }
  | { kind: 'params'; params: SelectorCatalogParam[] }
  /** A harness-wide list the host could not read right now: the value is not checked. */
  | { kind: 'unlisted' }

export interface AgentProfileOptionHost {
  /** Harness-wide lists; an absent key means the host has no list to offer. */
  lists?: Partial<Record<AgentProfileListOptionKey, readonly AgentProfileListChoice[]>>
  /** The subset of the harness's options this host can apply at launch (a CLI node applies fewer). */
  appliable?: readonly AgentProfileOptionKey[]
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/** One option's support on one model, or null when that model (or this host) cannot carry it. */
function choicesFor(
  key: AgentProfileOptionKey,
  model: OptionCatalogModel,
  host: AgentProfileOptionHost,
): AgentProfileOptionChoices | null {
  switch (key) {
    case 'ultracode':
      return model.supportedEffortLevels?.includes('xhigh') ? { kind: 'toggle' } : null
    case 'fastMode':
      return findCodexFastServiceTier(model) ? { kind: 'toggle' } : null
    case 'contextWindow': {
      const windows = model.contextWindows ?? []
      return windows.length > 1 ? { kind: 'choice', values: windows.map((value) => ({ value, label: formatContextWindow(value) })) } : null
    }
    case 'modelParams': {
      const params = selectorCatalogParams(model)
      return params.length ? { kind: 'params', params } : null
    }
    case 'mode':
    case 'agent':
    case 'agentPreset': {
      const list = host.lists?.[key]
      if (!list) return { kind: 'unlisted' }
      return list.length ? { kind: 'choice', values: [...list] } : null
    }
  }
}

/**
 * The options a harness offers for one model (or, with no model, for any of
 * them), each with its allowed values; null marks one that cannot be set.
 */
export function agentProfileOptionChoices(
  harnessId: HarnessId,
  models: readonly OptionCatalogModel[],
  host: AgentProfileOptionHost = {},
): Partial<Record<AgentProfileOptionKey, AgentProfileOptionChoices | null>> {
  const out: Partial<Record<AgentProfileOptionKey, AgentProfileOptionChoices | null>> = {}
  for (const key of HARNESS_PROFILE_OPTIONS[harnessId]) {
    if (host.appliable && !host.appliable.includes(key)) {
      out[key] = null
      continue
    }
    if (!isModelBoundOption(key)) {
      out[key] = choicesFor(key, { id: '' }, host)
      continue
    }
    // Several models (no model chosen): supported when any model supports it.
    out[key] = models.map((model) => choicesFor(key, model, host)).find((choice) => choice !== null) ?? null
  }
  return out
}

/** Why `value` is not allowed by `choices`, or null when it is. */
export function optionValueError(
  key: AgentProfileOptionKey,
  value: AgentProfileOptions[AgentProfileOptionKey],
  choices: AgentProfileOptionChoices,
): string | null {
  if (choices.kind === 'toggle' || choices.kind === 'unlisted') return null
  if (choices.kind === 'choice') {
    if (choices.values.some((choice) => choice.value === value)) return null
    return `options.${key} ${JSON.stringify(value)} is not one of: ${choices.values.map((choice) => JSON.stringify(choice.value)).join(', ')}.`
  }
  const params = value as Record<string, string>
  for (const [id, raw] of Object.entries(params)) {
    const param = choices.params.find((candidate) => candidate.id === id)
    if (!param) return `options.modelParams.${id} is not a parameter of this model (parameters: ${choices.params.map((p) => p.id).join(', ')}).`
    if (!param.values.some((candidate) => candidate.value === raw)) {
      return `options.modelParams.${id} "${raw}" is not one of: ${param.values.map((candidate) => candidate.value).join(', ')}.`
    }
  }
  return null
}

/** Structural check of one option value; catalog support is {@link optionValueError}. */
export function optionShapeError(key: string, value: unknown): string | null {
  const kind = OPTION_KINDS[key as AgentProfileOptionKey]
  if (!kind) return `profile.runtime.options has unknown field: ${key}.`
  const label = `profile.runtime.options.${key}`
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${label} must be a boolean.`
    case 'number':
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? null : `${label} must be a positive integer.`
    case 'string':
      return typeof value === 'string' && value.trim() ? null : `${label} must be a non-empty string.`
    case 'params': {
      const ok = !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length > 0
        && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0)
      return ok ? null : `${label} must map parameter ids to non-empty string values.`
    }
  }
}

/** A value as a confirm card shows it: toggles as `on` / `off` (translated by the client), the rest by label. */
export function optionDisplayValue(
  key: AgentProfileOptionKey,
  value: AgentProfileOptions[AgentProfileOptionKey],
  choices?: AgentProfileOptionChoices | null,
): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (key === 'contextWindow' && typeof value === 'number') return formatContextWindow(value)
  if (key === 'modelParams' && value && typeof value === 'object') {
    const params = choices?.kind === 'params' ? choices.params : []
    return Object.entries(value).map(([id, raw]) => {
      const param = params.find((candidate) => candidate.id === id)
      const label = param?.values.find((candidate) => candidate.value === raw)?.label ?? raw
      return `${param?.label ?? id}: ${label}`
    }).join(', ')
  }
  if (choices?.kind === 'choice') {
    return choices.values.find((choice) => choice.value === value)?.label ?? String(value)
  }
  return String(value)
}

/** What option rows are read from: a model catalog and this host's lists. */
export interface AgentProfileOptionCatalog {
  models: readonly OptionCatalogModel[]
  host?: AgentProfileOptionHost
}

/** The client's copy for option rows. */
export interface AgentProfileOptionLabels {
  field: (key: AgentProfileOptionKey) => string
  userDefault: string
  on: string
  off: string
}

/** Row id prefix of one Cursor model parameter (`modelParams.<id>`). */
const MODEL_PARAM_ROW = 'modelParams.'

function findCatalogModel(catalog: AgentProfileOptionCatalog, modelId: string | undefined): OptionCatalogModel | undefined {
  return modelId ? catalog.models.find((model) => model.id === modelId) : undefined
}

/**
 * A profile's options as model-selector rows for one model (any model when it
 * names none). Unset rows show `defaults` — what a launch would start with.
 * Options the model or host cannot carry, and lists not read yet, have no row.
 */
export function agentProfileOptionRows(
  harnessId: HarnessId,
  catalog: AgentProfileOptionCatalog,
  modelId: string | undefined,
  options: AgentProfileOptions | undefined,
  defaults: AgentProfileOptions | undefined,
  labels: AgentProfileOptionLabels,
): SelectorCatalogParam[] {
  const model = findCatalogModel(catalog, modelId)
  const choices = agentProfileOptionChoices(harnessId, model ? [model] : catalog.models, catalog.host)
  return HARNESS_PROFILE_OPTIONS[harnessId].flatMap((key): SelectorCatalogParam[] => {
    const choice = choices[key]
    const value = options?.[key] ?? defaults?.[key]
    if (!choice || choice.kind === 'unlisted') return []
    if (choice.kind === 'toggle') {
      return [{
        id: key,
        label: labels.field(key),
        kind: 'toggle',
        values: [{ value: 'false', label: labels.off }, { value: 'true', label: labels.on }],
        selected: value === true ? 'true' : 'false',
      }]
    }
    if (choice.kind === 'choice') {
      return [{
        id: key,
        label: labels.field(key),
        kind: 'choice',
        values: [{ value: '', label: labels.userDefault }, ...choice.values.map((entry) => ({ value: String(entry.value), label: entry.label }))],
        selected: options?.[key] === undefined ? '' : String(options[key]),
      }]
    }
    const params = (value ?? {}) as Record<string, string>
    return choice.params.map((param) => ({ ...param, id: `${MODEL_PARAM_ROW}${param.id}`, selected: params[param.id] ?? param.selected }))
  })
}

/** `options` with one row of {@link agentProfileOptionRows} set; an empty choice clears it. */
export function setAgentProfileOptionRow(
  options: AgentProfileOptions | undefined,
  rowId: string,
  value: string,
): AgentProfileOptions | undefined {
  const next: Record<string, unknown> = { ...options }
  if (rowId.startsWith(MODEL_PARAM_ROW)) {
    next.modelParams = { ...options?.modelParams, [rowId.slice(MODEL_PARAM_ROW.length)]: value }
  } else {
    const kind = OPTION_KINDS[rowId as AgentProfileOptionKey]
    if (!kind || kind === 'params') return options
    if (kind === 'boolean') next[rowId] = value === 'true'
    else if (!value) delete next[rowId]
    else next[rowId] = kind === 'number' ? Number(value) : value
  }
  return Object.keys(next).length ? next as AgentProfileOptions : undefined
}

/** The options `modelId` can still carry, the rest dropped; unchanged when the catalog does not list the model. */
export function agentProfileOptionsForModel(
  harnessId: HarnessId,
  catalog: AgentProfileOptionCatalog,
  modelId: string,
  options: AgentProfileOptions | undefined,
): AgentProfileOptions | undefined {
  const model = findCatalogModel(catalog, modelId)
  if (!options || !model) return options
  const choices = agentProfileOptionChoices(harnessId, [model], catalog.host)
  const kept = Object.entries(options).filter(([key, value]) => {
    const choice = choices[key as AgentProfileOptionKey]
    return !!choice && !optionValueError(key as AgentProfileOptionKey, value, choice)
  })
  return kept.length ? Object.fromEntries(kept) as AgentProfileOptions : undefined
}
