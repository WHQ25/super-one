/**
 * Agent Profile: a named, harness-agnostic agent stored on a
 * `session_providers` row as `config.profile`, next to (never inside) the
 * harness connection fields. Every provider row is already a launchable agent;
 * the profile adds who it is, what it is told, and how it runs by default.
 *
 * Runtime values are checked against the harness's model catalog, and options
 * against what the harness offers (`agent-profile-options.ts`) — a value the
 * catalog cannot carry is rejected by name, never dropped silently.
 */

import type { HarnessId, PermissionMode, SessionAgentLaunchConfig } from './agent-types'
import { HARNESS_LAUNCH_OPTIONS } from './launch-options'
import { codexPresetForPermissionMode } from './harness/harness-sandbox'
import {
  agentProfileOptionChoices,
  HARNESS_PROFILE_OPTIONS,
  isModelBoundOption,
  MODEL_REQUIRED_OPTIONS,
  optionShapeError,
  optionValueError,
  type AgentProfileOptionChoices,
  type AgentProfileOptionHost,
  type AgentProfileOptionKey,
  type AgentProfileOptions,
  type OptionCatalogModel,
} from './agent-profile-options'

export const AGENT_PROFILE_VERSION = 1

export const AGENT_PROFILE_NAME_MAX = 60
export const AGENT_PROFILE_DESCRIPTION_MAX = 500
export const AGENT_PROFILE_INSTRUCTIONS_MAX = 20_000

export interface AgentProfileRuntime {
  /** A catalog model id of the harness. */
  model?: string
  effort?: string
  /** The harness's own settings, keys from `HARNESS_PROFILE_OPTIONS`. */
  options?: AgentProfileOptions
  /** One of the harness's `HARNESS_LAUNCH_OPTIONS.permissionModes`; a harness without modes has none. */
  permissionMode?: PermissionMode
}

export interface AgentProfileSpec {
  version: typeof AGENT_PROFILE_VERSION
  identity: {
    /** Mirrors `session_providers.name`. */
    name: string
    /** What this agent is for. Other agents read it to pick whom to delegate to. */
    description: string
  }
  /** Appended to the harness system prompt, ahead of the collaboration protocol. */
  instructions?: string
  runtime?: AgentProfileRuntime
}

/** Launch fields a profile, a global preference or the launch itself can set. */
export type AgentLaunchDefaults = AgentProfileRuntime

/** The model fields a profile is checked against — structural, so desktop and CLI catalogs both fit. */
export interface CatalogModel extends OptionCatalogModel {
  supportedReasoningEfforts?: ReadonlyArray<{ value: string }>
  defaultReasoningEffort?: string | null
}

export interface AgentProfileCatalog {
  models: readonly CatalogModel[]
  /** Efforts a catalog lists outside its models (ACP session modes). */
  efforts?: readonly string[]
  /** Harness-wide option lists and what this host can apply. */
  host?: AgentProfileOptionHost
}

/** What one model can carry: its efforts and the harness options it allows. */
export interface AgentProfileModelSupport {
  efforts: string[]
  options: Partial<Record<AgentProfileOptionKey, AgentProfileOptionChoices | null>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function parseOptions(raw: unknown, harnessId: HarnessId | undefined): Parsed<AgentProfileOptions | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return { ok: false, error: 'profile.runtime.options must be an object.' }
  const allowed = harnessId ? HARNESS_PROFILE_OPTIONS[harnessId] : undefined
  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const shape = optionShapeError(key, value)
    if (shape) return { ok: false, error: shape }
    if (allowed && !allowed.includes(key as AgentProfileOptionKey)) {
      return { ok: false, error: `profile.runtime.options.${key} is not a ${harnessId} setting (${harnessId} has: ${allowed.join(', ') || 'none'}).` }
    }
    options[key] = typeof value === 'string' ? value.trim() : value
  }
  return { ok: true, value: Object.keys(options).length ? options as AgentProfileOptions : undefined }
}

function parseRuntime(raw: unknown, harnessId: HarnessId | undefined): Parsed<AgentProfileRuntime | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return { ok: false, error: 'profile.runtime must be an object.' }
  const unknown = Object.keys(raw).filter((key) => !['model', 'effort', 'options', 'permissionMode'].includes(key))
  if (unknown.length) return { ok: false, error: `profile.runtime has unknown field(s): ${unknown.join(', ')}.` }
  const runtime: AgentProfileRuntime = {}
  if (raw.model !== undefined) {
    const model = nonEmpty(raw.model)
    if (!model) return { ok: false, error: 'profile.runtime.model must be a non-empty string.' }
    runtime.model = model
  }
  if (raw.effort !== undefined) {
    const effort = nonEmpty(raw.effort)
    if (!effort) return { ok: false, error: 'profile.runtime.effort must be a non-empty string.' }
    runtime.effort = effort
  }
  if (raw.permissionMode !== undefined) {
    const mode = nonEmpty(raw.permissionMode)
    if (!mode) return { ok: false, error: 'profile.runtime.permissionMode must be a non-empty string.' }
    if (harnessId) {
      const offered = HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes
      if (!offered.includes(mode as PermissionMode)) {
        return {
          ok: false,
          error: offered.length
            ? `profile.runtime.permissionMode "${mode}" is not a ${harnessId} mode (${harnessId} has: ${offered.join(', ')}).`
            : `profile.runtime.permissionMode is not supported by ${harnessId}: it runs its own permission configuration.`,
        }
      }
    }
    runtime.permissionMode = mode as PermissionMode
  }
  const options = parseOptions(raw.options, harnessId)
  if (!options.ok) return options
  if (options.value) {
    const needsModel = Object.keys(options.value).find((key) => MODEL_REQUIRED_OPTIONS.has(key as AgentProfileOptionKey))
    if (needsModel && !runtime.model) return { ok: false, error: `profile.runtime.options.${needsModel} requires profile.runtime.model.` }
    runtime.options = options.value
  }
  return { ok: true, value: Object.keys(runtime).length ? runtime : undefined }
}

/**
 * Structural check of a stored or proposed profile; with `harnessId`, option
 * keys must be that harness's. Catalog support is {@link validateAgentProfileRuntime}.
 */
export function parseAgentProfileSpec(raw: unknown, harnessId?: HarnessId): Parsed<AgentProfileSpec> {
  if (!isRecord(raw)) return { ok: false, error: 'profile must be an object.' }
  if (raw.version !== AGENT_PROFILE_VERSION) {
    return { ok: false, error: `profile.version must be ${AGENT_PROFILE_VERSION}.` }
  }
  const unknown = Object.keys(raw).filter((key) => !['version', 'identity', 'instructions', 'runtime'].includes(key))
  if (unknown.length) return { ok: false, error: `profile has unknown field(s): ${unknown.join(', ')}.` }
  const identity = isRecord(raw.identity) ? raw.identity : null
  const name = nonEmpty(identity?.name)
  if (!name) return { ok: false, error: 'profile.identity.name must be a non-empty string.' }
  if (name.length > AGENT_PROFILE_NAME_MAX) {
    return { ok: false, error: `profile.identity.name must be at most ${AGENT_PROFILE_NAME_MAX} characters.` }
  }
  const description = nonEmpty(identity?.description)
  if (!description) return { ok: false, error: 'profile.identity.description must be a non-empty string.' }
  if (description.length > AGENT_PROFILE_DESCRIPTION_MAX) {
    return { ok: false, error: `profile.identity.description must be at most ${AGENT_PROFILE_DESCRIPTION_MAX} characters.` }
  }
  let instructions: string | undefined
  if (raw.instructions !== undefined) {
    if (typeof raw.instructions !== 'string') return { ok: false, error: 'profile.instructions must be a string.' }
    instructions = raw.instructions.trim() || undefined
    if (instructions && instructions.length > AGENT_PROFILE_INSTRUCTIONS_MAX) {
      return { ok: false, error: `profile.instructions must be at most ${AGENT_PROFILE_INSTRUCTIONS_MAX} characters.` }
    }
  }
  const runtime = parseRuntime(raw.runtime, harnessId)
  if (!runtime.ok) return runtime
  return {
    ok: true,
    value: {
      version: AGENT_PROFILE_VERSION,
      identity: { name, description },
      ...(instructions ? { instructions } : {}),
      ...(runtime.value ? { runtime: runtime.value } : {}),
    },
  }
}

/** The profile on a provider row's config, or null for base rows and unreadable specs. */
export function readAgentProfile(config: unknown): AgentProfileSpec | null {
  if (!isRecord(config) || config.profile === undefined) return null
  const parsed = parseAgentProfileSpec(config.profile)
  return parsed.ok ? parsed.value : null
}

/**
 * The runtime defaults a provider row asks its launches for. A profile owns
 * them whole once it exists; a row written before profiles carries them as
 * top-level `model` / `effort` (codex `reasoningEffort`) / `fastMode`.
 */
export function providerLaunchRuntime(config: unknown): AgentProfileRuntime | undefined {
  const profile = readAgentProfile(config)
  if (profile) return profile.runtime
  if (!isRecord(config)) return undefined
  const model = nonEmpty(config.model)
  const effort = nonEmpty(config.effort) ?? nonEmpty(config.reasoningEffort)
  const runtime: AgentProfileRuntime = {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(typeof config.fastMode === 'boolean' ? { options: { fastMode: config.fastMode } } : {}),
  }
  return Object.keys(runtime).length ? runtime : undefined
}

/** Profile instructions first, then any host protocol (collaboration), blank-line separated. */
export function composeSystemPromptAppend(...parts: Array<string | null | undefined>): string | undefined {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join('\n\n')
  return text || undefined
}

/**
 * Who a session of this profile is and what it is for, then the user's
 * instructions. Tagged like the collaboration block, so Markdown headings in
 * the instructions never clash with the prompt around them.
 */
export function agentProfilePrompt(profile: AgentProfileSpec): string {
  const { name, description } = profile.identity
  return [
    '<superone-agent-profile>',
    `You are running as "${name}", an agent profile the user saved in SuperOne. What it is for: ${description}`,
    ...(profile.instructions
      ? [
          'Follow the profile instructions below for this whole session.',
          '<instructions>',
          profile.instructions,
          '</instructions>',
        ]
      : []),
    '</superone-agent-profile>',
  ].join('\n')
}

/**
 * The append a session on this provider row starts with: its profile block
 * (none for a built-in row), then the host protocol. Read from the row on
 * every create and resume, so a profile edit reaches its sessions' next launch.
 */
export function providerSystemPromptAppend(config: unknown, protocol?: string): string | undefined {
  const profile = readAgentProfile(config)
  return composeSystemPromptAppend(profile ? agentProfilePrompt(profile) : undefined, protocol)
}

function findModel(catalog: AgentProfileCatalog, id: string | undefined): CatalogModel | undefined {
  return id ? catalog.models.find((model) => model.id === id) : undefined
}

function modelEfforts(catalog: AgentProfileCatalog, model: CatalogModel | undefined): string[] {
  if (model?.supportedEffortLevels) return [...model.supportedEffortLevels]
  if (model?.supportedReasoningEfforts) return model.supportedReasoningEfforts.map((effort) => effort.value)
  return [...(catalog.efforts ?? [])]
}

/** What a catalog model can carry on this harness, or null when the catalog does not list it. */
export function agentProfileModelSupport(
  harnessId: HarnessId,
  catalog: AgentProfileCatalog,
  modelId: string,
): AgentProfileModelSupport | null {
  const model = findModel(catalog, modelId)
  if (!model) return null
  return { efforts: modelEfforts(catalog, model), options: agentProfileOptionChoices(harnessId, [model], catalog.host) }
}

/**
 * Catalog check for a profile's runtime. Each message names the field and the
 * harness, so the authoring agent can correct the call instead of guessing.
 */
export function validateAgentProfileRuntime(
  runtime: AgentProfileRuntime | undefined,
  catalog: AgentProfileCatalog,
  harness: { id: HarnessId; name: string },
): string[] {
  if (!runtime) return []
  const optionKeys = Object.keys(runtime.options ?? {}) as AgentProfileOptionKey[]
  const needsCatalog = !!runtime.model || !!runtime.effort || optionKeys.some(isModelBoundOption)
  if (needsCatalog && catalog.models.length === 0) {
    return [`${harness.name} has no model catalog yet. Open a ${harness.name} session once, or leave runtime out.`]
  }
  const errors: string[] = []
  const model = findModel(catalog, runtime.model)
  if (runtime.model && !model) {
    const ids = catalog.models.map((option) => option.id)
    return [`runtime.model "${runtime.model}" is not in the ${harness.name} catalog. Available: ${ids.slice(0, 30).join(', ')}.`]
  }
  const label = model ? `${harness.name} model "${model.id}"` : harness.name
  if (runtime.effort) {
    const efforts = model
      ? modelEfforts(catalog, model)
      : [...new Set(catalog.models.flatMap((option) => modelEfforts(catalog, option)))]
    if (!efforts.includes(runtime.effort)) {
      errors.push(efforts.length
        ? `runtime.effort "${runtime.effort}" is not supported by ${model ? label : `any ${harness.name} model`} (supported: ${efforts.join(', ')}).`
        : `runtime.effort is not supported by ${label}.`)
    }
  }
  const choices = agentProfileOptionChoices(harness.id, model ? [model] : catalog.models, catalog.host)
  for (const key of optionKeys) {
    const choice = choices[key]
    if (choice === undefined) {
      errors.push(`options.${key} is not a ${harness.name} setting.`)
    } else if (choice === null) {
      errors.push(`options.${key} is not supported by ${label}.`)
    } else if (choice.kind === 'unlisted') {
      errors.push(`${harness.name} has not listed its ${key} values yet. Open a ${harness.name} session once, or leave options.${key} out.`)
    } else {
      const invalid = optionValueError(key, runtime.options![key], choice)
      if (invalid) errors.push(invalid)
    }
  }
  return errors
}

function fallbackEffort(model: CatalogModel | undefined, supported: readonly string[]): string | undefined {
  if (model?.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort
  if (supported.includes('high')) return 'high'
  if (supported.includes('medium')) return 'medium'
  return supported[0]
}

/**
 * What a launch runs with: its explicit values (`launch`), then the row's
 * runtime (`profile`, see {@link providerLaunchRuntime}), then the host's
 * global preference layer (`base`). The model is settled first; inherited
 * effort and options are kept only while that model (and this host) can carry
 * them. A launch model the catalog does not list (a provider's own model)
 * leaves nothing to check the inherited values against.
 */
export function resolveAgentLaunchDefaults(input: {
  harnessId: HarnessId
  catalog: AgentProfileCatalog
  base: AgentLaunchDefaults
  profile?: AgentProfileRuntime | null
  launch?: AgentLaunchDefaults
}): AgentLaunchDefaults {
  const { harnessId, catalog, base, profile } = input
  const launch = input.launch ?? {}
  const appliable = catalog.host?.appliable
  const uncatalogued = catalog.models.length === 0 || (!!launch.model && !findModel(catalog, launch.model))
  const model = uncatalogued
    ? undefined
    : findModel(catalog, launch.model) ?? findModel(catalog, profile?.model) ?? findModel(catalog, base.model)
  const choices = agentProfileOptionChoices(harnessId, model ? [model] : [], catalog.host)
  const options: Record<string, unknown> = {}
  for (const key of HARNESS_PROFILE_OPTIONS[harnessId]) {
    if (launch.options?.[key] !== undefined) {
      options[key] = launch.options[key]
      continue
    }
    const value = profile?.options?.[key] ?? base.options?.[key]
    if (value === undefined || (appliable && !appliable.includes(key))) continue
    // Nothing to check a model-bound value against: it was validated when written.
    const choice = model || !isModelBoundOption(key) ? choices[key] : { kind: 'unlisted' as const }
    if (choice && !optionValueError(key, value, choice)) options[key] = value
  }
  // Not model-bound: the first mode this harness still offers.
  const offeredModes = HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes
  const permissionMode = [launch.permissionMode, profile?.permissionMode, base.permissionMode]
    .find((mode) => mode && offeredModes.includes(mode))
  const result = (modelId: string | undefined, effort: string | undefined): AgentLaunchDefaults => ({
    ...(modelId ? { model: modelId } : {}),
    ...(effort ? { effort } : {}),
    ...(Object.keys(options).length ? { options: options as AgentProfileOptions } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  })
  if (uncatalogued) {
    return result(launch.model ?? profile?.model ?? base.model, launch.effort ?? profile?.effort ?? base.effort)
  }
  const supported = modelEfforts(catalog, model)
  const effort = launch.effort
    ?? [profile?.effort, base.effort].find((value) => value && supported.includes(value))
    ?? fallbackEffort(model, supported)
  return result(model?.id ?? base.model, effort)
}

/**
 * Explicit launch effort / options the launch's catalogued model cannot carry,
 * named by the launch `config` field. Uncatalogued models pass.
 */
export function agentLaunchErrors(
  harness: { id: HarnessId; name: string },
  catalog: AgentProfileCatalog,
  model: string | undefined,
  launch: AgentLaunchDefaults,
): string[] {
  const options = launch.options && Object.keys(launch.options).length ? launch.options : undefined
  if (!model || !findModel(catalog, model) || (!launch.effort && !options)) return []
  return validateAgentProfileRuntime({
    model,
    ...(launch.effort ? { effort: launch.effort } : {}),
    ...(options ? { options } : {}),
  }, catalog, harness).map((message) => message
    .replace(/^runtime\./, 'config.')
    .replace(/^options\.fastMode/, 'config.fastMode')
    .replace(/^options\./, 'config.options.'))
}

type LaunchRuntimeFields = Pick<SessionAgentLaunchConfig, 'model' | 'effort' | 'fastMode' | 'options' | 'permissionMode'>

/** Resolved defaults as launch config fields: Codex Fast keeps its own `fastMode` field. */
export function launchConfigFromDefaults(defaults: AgentLaunchDefaults): LaunchRuntimeFields {
  const { fastMode, ...options } = defaults.options ?? {}
  return {
    ...(defaults.model ? { model: defaults.model } : {}),
    ...(defaults.effort ? { effort: defaults.effort } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(defaults.permissionMode ? { permissionMode: defaults.permissionMode } : {}),
  }
}

/** Freeze the user-reviewed default layer, then apply an editable Profile proposal. */
export function profileApprovalConfig(
  harnessId: HarnessId,
  catalog: AgentProfileCatalog,
  baseConfig: SessionAgentLaunchConfig,
  profile: AgentProfileRuntime | undefined,
): SessionAgentLaunchConfig {
  const { model: _model, effort: _effort, fastMode: _fast, options: _options, permissionMode: _mode, codexPermissionPreset, ...host } = baseConfig
  const resolved = launchConfigFromDefaults(resolveAgentLaunchDefaults({ harnessId, catalog, base: { ...launchDefaultsFromConfig(baseConfig), permissionMode: baseConfig.permissionMode }, profile }))
  const permissionMode = resolved.permissionMode ?? baseConfig.permissionMode
  const preset = profile?.permissionMode && harnessId === 'codex' ? codexPresetForPermissionMode(profile.permissionMode) : codexPermissionPreset
  return { ...host, ...resolved, ...(permissionMode ? { permissionMode } : {}), ...(preset ? { codexPermissionPreset: preset } : {}) }
}

/** The fields a launch config sets explicitly, as resolver input. */
export function launchDefaultsFromConfig(config: LaunchRuntimeFields | undefined): AgentLaunchDefaults {
  const options = { ...config?.options, ...(typeof config?.fastMode === 'boolean' ? { fastMode: config.fastMode } : {}) }
  return {
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  }
}
