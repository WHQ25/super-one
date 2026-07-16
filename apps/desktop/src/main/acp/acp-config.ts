import type {
  AcpAgentConfigCatalog,
  AcpConfigOption,
  AcpConfigSelectValue,
  AcpSessionCatalog,
  ModelOption,
} from '@superone/shared/agent-types'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

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
  configId: string
  modes: ModelOption[]
  selectedModeId: string | null
}

function isModeSelect(o: ConfigOptionLike): boolean {
  return o.type === 'select' && (o.category === 'mode' || o.id === 'mode')
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

/** Prefer category "model", else option id "model", else first non-mode select. */
export function extractModelConfig(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModelConfig | null {
  if (!configOptions?.length) return null

  const selects = configOptions.filter((o) => o.type === 'select')
  if (selects.length === 0) return null

  const byCategory = selects.find((o) => o.category === 'model')
  const byId = selects.find((o) => o.id === 'model')
  const fallback = selects.find((o) => !isModeSelect(o))
  const chosen = byCategory ?? byId ?? fallback
  if (!chosen || chosen.type !== 'select' || typeof chosen.id !== 'string') return null

  const models: ModelOption[] = flattenSelectOptions(chosen.options).map((opt) => ({
    id: opt.value,
    name: opt.name,
    description: opt.description,
  }))
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

/** Prefer category "mode", else option id "mode". No fallback to other selects. */
export function extractModeConfig(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
): AcpModeConfig | null {
  if (!configOptions?.length) return null

  const selects = configOptions.filter((o) => o.type === 'select')
  const chosen = selects.find((o) => o.category === 'mode')
    ?? selects.find((o) => o.id === 'mode')
  if (!chosen || chosen.type !== 'select' || typeof chosen.id !== 'string') return null

  const modes: ModelOption[] = flattenSelectOptions(chosen.options).map((opt) => ({
    id: opt.value,
    name: opt.name,
    description: opt.description,
  }))
  if (modes.length === 0) return null

  const selected =
    typeof chosen.currentValue === 'string' && modes.some((m) => m.id === chosen.currentValue)
      ? chosen.currentValue
      : (modes[0]?.id ?? null)

  return {
    configId: chosen.id,
    modes,
    selectedModeId: selected,
  }
}

/** Build session-facing catalog from a persisted agent config snapshot. */
export function deriveSessionCatalog(catalog: AcpAgentConfigCatalog): AcpSessionCatalog {
  const fromOptions = extractModelConfig(catalog.configOptions)
  const models = fromOptions?.models.length
    ? fromOptions.models
    : (catalog.extraModels ?? [])
  const selectedModelId =
    (fromOptions?.selectedModelId
      ?? catalog.selectedModelId
      ?? models[0]?.id
      ?? null)
  const modelConfigId = fromOptions?.configId ?? catalog.modelConfigId ?? null
  const modesCfg = extractModeConfig(catalog.configOptions)
  return {
    configOptions: catalog.configOptions,
    models,
    selectedModelId:
      selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : (models[0]?.id ?? null),
    modelConfigId,
    modes: modesCfg?.modes ?? [],
    selectedModeId: modesCfg?.selectedModeId ?? null,
    modeConfigId: modesCfg?.configId ?? null,
    slashCommands: catalog.slashCommands ?? [],
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
    models.push({
      id,
      name,
      description: typeof m.description === 'string' ? m.description : '',
    })
  }
  if (models.length === 0) return null

  const current =
    typeof obj.currentModelId === 'string' && models.some((m) => m.id === obj.currentModelId)
      ? obj.currentModelId
      : (models[0]?.id ?? null)

  return { configId: null, models, selectedModelId: current }
}

/** Grok: `_meta["x.ai/sessionConfig"].options` with category model. */
export function extractModelsFromXaiSessionConfig(meta: unknown): AcpModelConfig | null {
  if (!meta || typeof meta !== 'object') return null
  const sessionConfig = (meta as Record<string, unknown>)['x.ai/sessionConfig']
  if (!sessionConfig || typeof sessionConfig !== 'object') return null
  const options = (sessionConfig as Record<string, unknown>).options
  if (!Array.isArray(options)) return null

  const models: ModelOption[] = []
  let selected: string | null = null
  for (const item of options) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.category !== 'model') continue
    const id = typeof o.id === 'string' ? o.id : null
    const label = typeof o.label === 'string' ? o.label : id
    if (!id || !label) continue
    models.push({ id, name: label, description: typeof o.description === 'string' ? o.description : '' })
    if (o.selected === true) selected = id
  }
  if (models.length === 0) return null
  return {
    configId: null,
    models,
    selectedModelId: selected && models.some((m) => m.id === selected) ? selected : (models[0]?.id ?? null),
  }
}

/**
 * Agent-declared capabilities from `initialize`. Only the fields SuperOne acts on.
 * Everything is optional — an agent that omits a flag does not support it.
 */
export interface AcpAgentCapabilities {
  loadSession: boolean
  mcp: { http: boolean; sse: boolean; acp: boolean }
  sessionCapabilities: { additionalDirectories: boolean }
}

export function readAgentCapabilities(result: unknown): AcpAgentCapabilities | null {
  if (!result || typeof result !== 'object') return null
  const caps = (result as Record<string, unknown>).agentCapabilities
  if (!caps || typeof caps !== 'object') return null
  const c = caps as Record<string, unknown>
  const mcp = (c.mcpCapabilities ?? {}) as Record<string, unknown>
  const session = (c.sessionCapabilities ?? {}) as Record<string, unknown>
  return {
    loadSession: c.loadSession === true,
    mcp: {
      http: mcp.http === true,
      sse: mcp.sse === true,
      acp: mcp.acp === true,
    },
    sessionCapabilities: {
      // `{}` means supported; null/undefined means not.
      additionalDirectories: !!session.additionalDirectories,
    },
  }
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
  if (fromConfig) return fromConfig

  const fromModels = extractModelsFromAgentModelsField(r.models)
  if (fromModels) return fromModels

  return extractModelsFromXaiSessionConfig(r._meta)
}

/** First non-null extraction wins (standard ACP → Grok fields). */
export function coalesceModelConfig(...candidates: Array<AcpModelConfig | null | undefined>): AcpModelConfig | null {
  for (const c of candidates) {
    if (c && c.models.length > 0) return c
  }
  return null
}
