/**
 * Agent Profile: a named, harness-agnostic agent stored on a
 * `session_providers` row as `config.profile`, next to (never inside) the
 * harness connection fields. Every provider row is already a launchable agent;
 * the profile adds who it is, what it is told, and how it runs by default.
 *
 * Runtime values are checked against the harness's model catalog — a field the
 * catalog cannot carry is rejected by name, never dropped silently.
 */

import { hasOneM, ONE_M_SUFFIX, stripOneM, type ModelOption } from './agent-types'
import { findCodexFastServiceTier } from './codex-fast-mode'

export const AGENT_PROFILE_VERSION = 1

export const AGENT_PROFILE_NAME_MAX = 60
export const AGENT_PROFILE_DESCRIPTION_MAX = 500
export const AGENT_PROFILE_INSTRUCTIONS_MAX = 20_000

/** `1m`: the model's 1M-token context variant (the catalog's `<id>[1m]` row). */
export type AgentProfileContext = 'default' | '1m'

export interface AgentProfileRuntime {
  /** Base catalog id; the context variant is chosen by {@link context}. */
  model?: string
  effort?: string
  fastMode?: boolean
  /** Requires {@link model}. Absent means the default window. */
  context?: '1m'
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

/** Launch fields a profile or a global preference can default. */
export interface AgentLaunchDefaults {
  model?: string
  effort?: string
  fastMode?: boolean
}

/** The model fields a profile is checked against — structural, so desktop and CLI catalogs both fit. */
interface CatalogModel {
  id: string
  supportedEffortLevels?: readonly string[]
  supportedReasoningEfforts?: ReadonlyArray<{ value: string }>
  defaultReasoningEffort?: string | null
  serviceTiers?: ModelOption['serviceTiers']
}

export interface AgentProfileCatalog {
  models: readonly CatalogModel[]
  /** Efforts a catalog lists outside its models (ACP session modes). */
  efforts?: readonly string[]
}

/** What one model can carry — the honest per-field support a profile is checked against. */
export interface AgentProfileModelSupport {
  efforts: string[]
  fastMode: boolean
  contexts: AgentProfileContext[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function parseRuntime(raw: unknown): Parsed<AgentProfileRuntime | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return { ok: false, error: 'profile.runtime must be an object.' }
  const unknown = Object.keys(raw).filter((key) => !['model', 'effort', 'fastMode', 'context'].includes(key))
  if (unknown.length) return { ok: false, error: `profile.runtime has unknown field(s): ${unknown.join(', ')}.` }
  const runtime: AgentProfileRuntime = {}
  if (raw.model !== undefined) {
    const model = nonEmpty(raw.model)
    if (!model) return { ok: false, error: 'profile.runtime.model must be a non-empty string.' }
    if (hasOneM(model)) return { ok: false, error: `profile.runtime.model takes the base id; use context "1m" instead of "${ONE_M_SUFFIX}".` }
    runtime.model = model
  }
  if (raw.effort !== undefined) {
    const effort = nonEmpty(raw.effort)
    if (!effort) return { ok: false, error: 'profile.runtime.effort must be a non-empty string.' }
    runtime.effort = effort
  }
  if (raw.fastMode !== undefined) {
    if (typeof raw.fastMode !== 'boolean') return { ok: false, error: 'profile.runtime.fastMode must be a boolean.' }
    runtime.fastMode = raw.fastMode
  }
  if (raw.context !== undefined) {
    if (raw.context !== '1m') return { ok: false, error: 'profile.runtime.context must be "1m" when set.' }
    if (!runtime.model) return { ok: false, error: 'profile.runtime.context requires profile.runtime.model.' }
    runtime.context = '1m'
  }
  return { ok: true, value: Object.keys(runtime).length ? runtime : undefined }
}

/** Structural check of a stored or proposed profile. Catalog support is {@link validateAgentProfileRuntime}. */
export function parseAgentProfileSpec(raw: unknown): Parsed<AgentProfileSpec> {
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
  const runtime = parseRuntime(raw.runtime)
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

/** The model id a launch sends: the base id, with the context variant applied. */
export function agentProfileModelId(runtime: AgentProfileRuntime | undefined): string | undefined {
  if (!runtime?.model) return undefined
  return runtime.context === '1m' ? `${runtime.model}${ONE_M_SUFFIX}` : runtime.model
}

/** Profile instructions first, then any host protocol (collaboration), blank-line separated. */
export function composeSystemPromptAppend(...parts: Array<string | null | undefined>): string | undefined {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join('\n\n')
  return text || undefined
}

function findModel(catalog: AgentProfileCatalog, id: string | undefined): CatalogModel | undefined {
  return id ? catalog.models.find((model) => model.id === id) : undefined
}

function modelEfforts(catalog: AgentProfileCatalog, model: CatalogModel | undefined): string[] {
  if (model?.supportedEffortLevels) return [...model.supportedEffortLevels]
  if (model?.supportedReasoningEfforts) return model.supportedReasoningEfforts.map((effort) => effort.value)
  return [...(catalog.efforts ?? [])]
}

/** Per-field support for a base model id, or null when the catalog does not list it. */
export function agentProfileModelSupport(
  catalog: AgentProfileCatalog,
  modelId: string,
): AgentProfileModelSupport | null {
  const base = stripOneM(modelId)
  const standard = findModel(catalog, base)
  const extended = findModel(catalog, `${base}${ONE_M_SUFFIX}`)
  const model = standard ?? extended
  if (!model) return null
  return {
    efforts: modelEfforts(catalog, model),
    fastMode: !!findCodexFastServiceTier(model),
    contexts: [...(standard ? ['default' as const] : []), ...(extended ? ['1m' as const] : [])],
  }
}

/**
 * Catalog check for a profile's runtime. Each message names the field and the
 * harness, so the authoring agent can correct the call instead of guessing.
 */
export function validateAgentProfileRuntime(
  runtime: AgentProfileRuntime | undefined,
  catalog: AgentProfileCatalog,
  harnessName: string,
): string[] {
  if (!runtime) return []
  if (catalog.models.length === 0) {
    return [`${harnessName} has no model catalog yet. Open a ${harnessName} session once, or leave runtime out.`]
  }
  const errors: string[] = []
  if (runtime.model) {
    const support = agentProfileModelSupport(catalog, runtime.model)
    if (!support) {
      const ids = [...new Set(catalog.models.map((model) => stripOneM(model.id)))]
      return [`runtime.model "${runtime.model}" is not in the ${harnessName} catalog. Available: ${ids.slice(0, 30).join(', ')}.`]
    }
    const label = `${harnessName} model "${runtime.model}"`
    if (runtime.effort && !support.efforts.includes(runtime.effort)) {
      errors.push(support.efforts.length
        ? `runtime.effort "${runtime.effort}" is not supported by ${label} (supported: ${support.efforts.join(', ')}).`
        : `runtime.effort is not supported by ${label}.`)
    }
    if (runtime.fastMode && !support.fastMode) errors.push(`runtime.fastMode is not supported by ${label}.`)
    if (runtime.context === '1m' && !support.contexts.includes('1m')) {
      errors.push(`runtime.context "1m" is not supported by ${label}.`)
    }
    if (!runtime.context && !support.contexts.includes('default')) {
      errors.push(`${label} only has a 1M-context variant; set runtime.context to "1m".`)
    }
    return errors
  }
  if (runtime.effort) {
    const efforts = new Set(catalog.models.flatMap((model) => modelEfforts(catalog, model)))
    if (!efforts.has(runtime.effort)) {
      errors.push(efforts.size
        ? `runtime.effort "${runtime.effort}" is not supported by any ${harnessName} model (supported: ${[...efforts].join(', ')}).`
        : `runtime.effort is not supported by ${harnessName}.`)
    }
  }
  if (runtime.fastMode) errors.push('runtime.fastMode requires runtime.model.')
  return errors
}

function fallbackEffort(model: CatalogModel | undefined, supported: readonly string[]): string | undefined {
  if (model?.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort
  if (supported.includes('high')) return 'high'
  if (supported.includes('medium')) return 'medium'
  return supported[0]
}

/**
 * The defaults a launch inherits: profile over the host's global preference
 * layer (`base`), each kept only while the effective model supports it.
 * Explicit launch arguments are spread over the result by the caller.
 */
export function resolveAgentLaunchDefaults(input: {
  catalog: AgentProfileCatalog
  base: AgentLaunchDefaults
  profile?: AgentProfileRuntime | null
}): AgentLaunchDefaults {
  const { catalog, base, profile } = input
  const profileModel = agentProfileModelId(profile ?? undefined)
  const hasFastField = base.fastMode !== undefined || profile?.fastMode !== undefined
  const result = (model: string | undefined, effort: string | undefined, fastMode: boolean | undefined): AgentLaunchDefaults => ({
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  })
  if (catalog.models.length === 0) {
    // Nothing to check against: the profile was validated when it was written.
    return result(profileModel ?? base.model, profile?.effort ?? base.effort, hasFastField ? (profile?.fastMode ?? base.fastMode) : undefined)
  }
  // A profile model the catalog no longer lists falls back to the user's default.
  const model = findModel(catalog, profileModel) ?? findModel(catalog, base.model)
  const supported = modelEfforts(catalog, model)
  const effort = [profile?.effort, base.effort].find((value) => value && supported.includes(value))
    ?? fallbackEffort(model, supported)
  const fastMode = hasFastField ? !!findCodexFastServiceTier(model) && (profile?.fastMode ?? base.fastMode ?? false) : undefined
  return result(model?.id ?? base.model, effort, fastMode)
}
