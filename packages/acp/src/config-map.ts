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
  /**
   * ACP configId for session/set_config_option.
   * null when modes come from Grok x.ai/sessionConfig (effort via session/set_model + _meta.reasoningEffort).
   */
  configId: string | null
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
