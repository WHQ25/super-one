import type {
  AcpAgentConfigCatalog,
  AcpConfigOption,
  AcpConfigSelectValue,
  AcpSessionCatalog,
  ModelOption,
} from '@superone/shared/agent-types'
import { isAcpEffortConfigOption } from '@superone/shared/effort-labels'
import { withoutProjectScopedWorkflows } from '@superone/shared/workflow-commands'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import {
  asEffortLevel,
  asGrokReasoningEffort,
  extractModelsFromXaiSessionConfig,
  extractModesFromXaiSessionConfig,
  sortEffortModesAscending,
} from './acp-xai-config'
import {
  ACP_SESSION_SET_MODEL,
  type AcpAgentCapabilities,
  type AcpSetModelOptions,
  buildSetModelParams,
  readAgentCapabilities,
} from './acp-capabilities'

export {
  ACP_SESSION_SET_MODEL,
  type AcpAgentCapabilities,
  type AcpSetModelOptions,
  asEffortLevel,
  asGrokReasoningEffort,
  buildSetModelParams,
  extractModelsFromXaiSessionConfig,
  extractModesFromXaiSessionConfig,
  readAgentCapabilities,
  sortEffortModesAscending,
}

export interface AcpModelConfig {
  /** ACP configId for session/set_config_option; null when agent uses non-standard model API. */
  configId: string | null
  models: ModelOption[]
  selectedModelId: string | null
}

/** Loose config option shape (SDK SessionConfigOption or cached AcpConfigOption). */
export type ConfigOptionLike = {
  id?: string
  name?: string
  description?: string | null
  category?: string | null
  type?: string
  currentValue?: string | boolean | null
  options?: unknown
}

type SelectOptionLike = {
  value?: string
  name?: string
  description?: string | null
  options?: SelectOptionLike[]
}

function flattenSelectOptions(options: unknown): Array<{ value: string; name: string; description: string }> {
  if (!Array.isArray(options)) return []
  const out: Array<{ value: string; name: string; description: string }> = []
  for (const item of options as SelectOptionLike[]) {
    if (typeof item?.value === 'string' && typeof item?.name === 'string') {
      out.push({
        value: item.value,
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
      })
      continue
    }
    if (Array.isArray(item?.options)) {
      for (const nested of item.options) {
        if (typeof nested?.value === 'string' && typeof nested?.name === 'string') {
          out.push({
            value: nested.value,
            name: nested.name,
            description: typeof nested.description === 'string' ? nested.description : '',
          })
        }
      }
    }
  }
  return out
}

export interface AcpModeConfig {
  /**
   * ACP configId for session/set_config_option.
   * `reasoning_effort` is Grok thought_level (effort slider, session/set_config_option).
   * null when modes come from Grok x.ai/sessionConfig (effort via session/set_model + _meta.reasoningEffort).
   * `mode` is a real session mode (OpenCode), not reasoning effort.
   */
  configId: string | null
  modes: ModelOption[]
  selectedModeId: string | null
}

function isModeSelect(o: ConfigOptionLike): boolean {
  return o.type === 'select' && (o.category === 'mode' || o.id === 'mode')
}

function isReasoningEffortSelect(o: ConfigOptionLike): boolean {
  return (o.type == null || o.type === 'select') && isAcpEffortConfigOption(o)
}

function serializeSelectValues(options: unknown): AcpConfigSelectValue[] | undefined {
  if (!Array.isArray(options)) return undefined
  const out: AcpConfigSelectValue[] = []
  for (const item of options as SelectOptionLike[]) {
    if (typeof item?.value === 'string' && typeof item?.name === 'string') {
      out.push({
        value: item.value,
        name: item.name,
        description: typeof item.description === 'string' ? item.description : null,
      })
      continue
    }
    if (Array.isArray(item?.options)) {
      const nested = serializeSelectValues(item.options)
      if (nested?.length) {
        out.push({
          name: typeof item?.name === 'string' ? item.name : undefined,
          options: nested,
        })
      }
    }
  }
  return out.length ? out : undefined
}

/** Strip SDK-only fields so configOptions can live in harness_resource_cache JSON. */
export function serializeConfigOptions(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpConfigOption[] {
  if (!configOptions?.length) return []
  const out: AcpConfigOption[] = []
  for (const o of configOptions) {
    if (!o || typeof o !== 'object') continue
    const id = typeof o.id === 'string' ? o.id : null
    const name = typeof o.name === 'string' ? o.name : id
    if (!id || !name) continue
    const type = typeof o.type === 'string' ? o.type : 'select'
    const entry: AcpConfigOption = {
      id,
      name,
      type,
      description: typeof o.description === 'string' ? o.description : null,
      category: typeof o.category === 'string' ? o.category : null,
      currentValue:
        typeof o.currentValue === 'string' || typeof o.currentValue === 'boolean'
          ? o.currentValue
          : null,
    }
    if (type === 'select') {
      entry.options = serializeSelectValues((o as ConfigOptionLike).options)
    }
    out.push(entry)
  }
  return out
}

/** Prefer category "model", else option id "model", else first select that is neither a session mode nor reasoning effort. */
export function extractModelConfig(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModelConfig | null {
  if (!configOptions?.length) return null

  const selects = configOptions.filter((o) => o.type === 'select')
  if (selects.length === 0) return null

  const byCategory = selects.find((o) => o.category === 'model')
  const byId = selects.find((o) => o.id === 'model')
  const fallback = selects.find((o) => !isModeSelect(o) && !isReasoningEffortSelect(o))
  const chosen = byCategory ?? byId ?? fallback
  if (!chosen || chosen.type !== 'select' || typeof chosen.id !== 'string') return null

  const names = new Set<string>()
  const models: ModelOption[] = flattenSelectOptions(chosen.options).map((opt) => {
    const baseName = opt.name.trim() ? opt.name : opt.value
    const name = names.has(baseName) ? `${baseName} (${opt.value})` : baseName
    names.add(baseName)
    return {
      id: opt.value,
      name,
      description: opt.description,
    }
  })
  if (models.length === 0) return null

  const selected =
    typeof chosen.currentValue === 'string' && models.some((m) => m.id === chosen.currentValue)
      ? chosen.currentValue
      : (models[0]?.id ?? null)

  return {
    configId: chosen.id,
    models,
    selectedModelId: selected,
  }
}

function selectToModeConfig(
  chosen: ConfigOptionLike,
  opts?: { sortEffort?: boolean },
): AcpModeConfig | null {
  if ((chosen.type != null && chosen.type !== 'select') || typeof chosen.id !== 'string') return null
  const modes: ModelOption[] = flattenSelectOptions(chosen.options).map((opt) => ({
    id: opt.value,
    name: opt.name,
    description: opt.description,
  }))
  if (modes.length === 0) return null
  const ordered = opts?.sortEffort ? sortEffortModesAscending(modes) : modes
  const selected =
    typeof chosen.currentValue === 'string' && ordered.some((m) => m.id === chosen.currentValue)
      ? chosen.currentValue
      : (ordered[0]?.id ?? null)
  return {
    configId: chosen.id,
    modes: ordered,
    selectedModeId: selected,
  }
}

/**
 * Grok reasoning effort: config id `reasoning_effort`, category `thought_level`.
 * Values stay on the model-selector slider and change via session/set_config_option.
 */
export function extractReasoningEffortConfig(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModeConfig | null {
  if (!configOptions?.length) return null
  const chosen = configOptions.find((o) => isReasoningEffortSelect(o))
  if (!chosen) return null
  return selectToModeConfig(chosen, { sortEffort: true })
}

/** Prefer category "mode", else option id "mode". No fallback to other selects. */
export function extractModeConfig(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModeConfig | null {
  if (!configOptions?.length) return null

  const selects = configOptions.filter((o) => o.type === 'select')
  const chosen = selects.find((o) => o.category === 'mode')
    ?? selects.find((o) => o.id === 'mode')
  if (!chosen) return null
  return selectToModeConfig(chosen)
}

/**
 * Effort catalog when Grok advertises `reasoning_effort`, otherwise a real
 * session-mode select. Does not read x.ai/sessionConfig.
 */
export function modesFromConfigOptions(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModeConfig | null {
  return extractReasoningEffortConfig(configOptions) ?? extractModeConfig(configOptions)
}

function overlayModelOption(primary: ModelOption, extra: ModelOption | undefined): ModelOption {
  if (!extra) return primary
  return {
    ...primary,
    ...(primary.contextWindow == null && extra.contextWindow != null
      ? { contextWindow: extra.contextWindow }
      : {}),
    ...(primary.supportsEffort == null && extra.supportsEffort != null
      ? { supportsEffort: extra.supportsEffort }
      : {}),
    ...(primary.supportedEffortLevels == null && extra.supportedEffortLevels != null
      ? { supportedEffortLevels: extra.supportedEffortLevels }
      : {}),
    ...(primary.contextWindows == null && extra.contextWindows != null
      ? { contextWindows: extra.contextWindows }
      : {}),
  }
}

function overlayModelList(primary: ModelOption[], extras: ModelOption[]): ModelOption[] {
  if (extras.length === 0) return primary
  const byId = new Map(extras.map((model) => [model.id, model]))
  return primary.map((model) => overlayModelOption(model, byId.get(model.id)))
}

/**
 * Keep the winner's picker list / configId / selection, and fill window / effort
 * metadata from later catalogs. Grok `session/new` now ships both ACP
 * `configOptions` (no window) and `models` (`_meta.totalContextTokens`).
 */
export function mergeModelConfig(
  primary: AcpModelConfig,
  ...sources: Array<AcpModelConfig | null | undefined>
): AcpModelConfig {
  let models = primary.models
  for (const source of sources) {
    if (source?.models.length) models = overlayModelList(models, source.models)
  }
  return models === primary.models ? primary : { ...primary, models }
}

/** Build session-facing catalog from a persisted agent config snapshot. */
export function deriveSessionCatalog(catalog: AcpAgentConfigCatalog): AcpSessionCatalog {
  const fromOptions = extractModelConfig(catalog.configOptions)
  const extras = catalog.extraModels ?? []
  const models = fromOptions?.models.length
    ? overlayModelList(fromOptions.models, extras)
    : extras
  const selectedModelId =
    (fromOptions?.selectedModelId
      ?? catalog.selectedModelId
      ?? models[0]?.id
      ?? null)
  const modelConfigId = fromOptions?.configId ?? catalog.modelConfigId ?? null
  // Grok thought_level wins over a session mode and over legacy extraModes.
  const modesCfg = modesFromConfigOptions(catalog.configOptions)
  // Prefer standard configOptions modes; else Grok-style extraModes (modeConfigId may be null).
  const modes = modesCfg?.modes.length
    ? modesCfg.modes
    : (catalog.extraModes ?? [])
  const selectedModeId = modesCfg?.selectedModeId
    ?? (catalog.selectedModeId && modes.some((m) => m.id === catalog.selectedModeId)
      ? catalog.selectedModeId
      : null)
    ?? modes[0]?.id
    ?? null
  const modeConfigId = modesCfg?.configId
    ?? (modes.length > 0 ? (catalog.modeConfigId ?? null) : null)
  return {
    configOptions: catalog.configOptions,
    models,
    selectedModelId:
      selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : (models[0]?.id ?? null),
    modelConfigId,
    modes,
    selectedModeId:
      selectedModeId && modes.some((m) => m.id === selectedModeId)
        ? selectedModeId
        : (modes[0]?.id ?? null),
    modeConfigId,
    slashCommands: withoutProjectScopedWorkflows(catalog.slashCommands ?? []),
    updatedAt: catalog.updatedAt,
  }
}

export function modelCatalogFromSession(session: AcpSessionCatalog): {
  models: ModelOption[]
  selectedModelId: string | null
  configId: string | null
  updatedAt: string
} | null {
  if (!session.models.length) return null
  return {
    models: session.models,
    selectedModelId: session.selectedModelId,
    configId: session.modelConfigId,
    updatedAt: session.updatedAt,
  }
}

/** Grok / some agents: initialize or session/new `_meta.modelState` / top-level `models`. */
export function extractModelsFromAgentModelsField(raw: unknown): AcpModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const available = obj.availableModels
  if (!Array.isArray(available) || available.length === 0) return null

  const models: ModelOption[] = []
  for (const item of available) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const id = typeof m.modelId === 'string' ? m.modelId : typeof m.id === 'string' ? m.id : null
    const name = typeof m.name === 'string' ? m.name : id
    if (!id || !name) continue
    // Grok stamps window on model meta as totalContextTokens; also accept common aliases.
    const meta = (m._meta && typeof m._meta === 'object' && !Array.isArray(m._meta)
      ? m._meta
      : m.meta && typeof m.meta === 'object' && !Array.isArray(m.meta)
        ? m.meta
        : null) as Record<string, unknown> | null
    const rawCw =
      (typeof m.contextWindow === 'number' ? m.contextWindow : undefined)
      ?? (meta && typeof meta.totalContextTokens === 'number' ? meta.totalContextTokens : undefined)
      ?? (meta && typeof meta.context_window === 'number' ? meta.context_window : undefined)
      ?? (meta && typeof meta.contextWindow === 'number' ? meta.contextWindow : undefined)
    const contextWindow = typeof rawCw === 'number' && Number.isFinite(rawCw) && rawCw > 0 ? rawCw : undefined
    const listedWindows = parseContextWindows(meta?.contextWindows ?? m.contextWindows)
    const effortLevels = parseModelEffortLevels(m, meta)
    models.push({
      id,
      name,
      description: typeof m.description === 'string' ? m.description : '',
      ...(contextWindow != null ? { contextWindow } : {}),
      ...(listedWindows ? { contextWindows: listedWindows } : {}),
      ...(effortLevels ? { supportsEffort: true, supportedEffortLevels: effortLevels } : {}),
    })
  }
  if (models.length === 0) return null

  const current =
    typeof obj.currentModelId === 'string' && models.some((m) => m.id === obj.currentModelId)
      ? obj.currentModelId
      : (models[0]?.id ?? null)

  return { configId: null, models, selectedModelId: current }
}

function parseContextWindows(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const windows = raw.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
  return windows.length > 0 ? windows : undefined
}

const ACP_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

function parseModelEffortLevels(
  model: Record<string, unknown>,
  meta: Record<string, unknown> | null,
): ModelOption['supportedEffortLevels'] {
  const raw = model.reasoningEfforts
    ?? model.reasoning_efforts
    ?? meta?.reasoningEfforts
    ?? meta?.reasoning_efforts
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<ModelOption['supportedEffortLevels']> = []
  for (const item of raw) {
    const value = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' && !Array.isArray(item)
        ? (item as { value?: unknown }).value
        : null)
    if (typeof value !== 'string') continue
    const key = value.trim().toLowerCase()
    if (ACP_EFFORT_LEVELS.has(key)) out.push(key as NonNullable<ModelOption['supportedEffortLevels']>[number])
  }
  return out.length > 0 ? out : undefined
}

/** Modes from session/new: Grok reasoning_effort, else session mode, else x.ai sessionConfig. */
export function extractModesFromNewSessionResult(result: unknown): AcpModeConfig | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const fromConfig = modesFromConfigOptions(r.configOptions as SessionConfigOption[] | undefined)
  if (fromConfig) return fromConfig
  return extractModesFromXaiSessionConfig(r._meta)
}

export function coalesceModeConfig(...candidates: Array<AcpModeConfig | null | undefined>): AcpModeConfig | null {
  for (const c of candidates) {
    if (c && c.modes.length > 0) return c
  }
  return null
}

export function extractModelsFromInitializeResult(result: unknown): AcpModelConfig | null {
  if (!result || typeof result !== 'object') return null
  const meta = (result as Record<string, unknown>)._meta
  if (!meta || typeof meta !== 'object') return null
  const modelState = (meta as Record<string, unknown>).modelState
  return extractModelsFromAgentModelsField(modelState)
}

export function extractModelsFromNewSessionResult(result: unknown): AcpModelConfig | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>

  const fromConfig = extractModelConfig(r.configOptions as SessionConfigOption[] | undefined)
  const fromModels = extractModelsFromAgentModelsField(r.models)
  const fromXai = extractModelsFromXaiSessionConfig(r._meta)
  if (fromConfig) return mergeModelConfig(fromConfig, fromModels, fromXai)
  return fromModels ?? fromXai
}

/** First non-empty catalog wins the picker; later catalogs fill missing metadata. */
export function coalesceModelConfig(...candidates: Array<AcpModelConfig | null | undefined>): AcpModelConfig | null {
  const present = candidates.filter((c): c is AcpModelConfig => !!c && c.models.length > 0)
  if (present.length === 0) return null
  return mergeModelConfig(present[0]!, ...present.slice(1))
}
