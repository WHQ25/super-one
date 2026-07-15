import type { ModelOption } from '@superone/shared/agent-types'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

export interface AcpModelConfig {
  /** ACP configId for session/set_config_option; null when agent uses non-standard model API. */
  configId: string | null
  models: ModelOption[]
  selectedModelId: string | null
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

/** Prefer category "model", else option id "model", else first select with options. */
export function extractModelConfig(
  configOptions: SessionConfigOption[] | null | undefined,
): AcpModelConfig | null {
  if (!configOptions?.length) return null

  const selects = configOptions.filter((o) => o.type === 'select')
  if (selects.length === 0) return null

  const byCategory = selects.find((o) => o.category === 'model')
  const byId = selects.find((o) => o.id === 'model')
  const chosen = byCategory ?? byId ?? selects[0]
  if (!chosen || chosen.type !== 'select') return null

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
