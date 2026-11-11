import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'

export interface AcpXaiCatalogSlice {
  configId: string | null
  models?: ModelOption[]
  modes?: ModelOption[]
  selectedModelId?: string | null
  selectedModeId?: string | null
}

function xaiSessionConfigOptions(meta: unknown): unknown[] | null {
  if (!meta || typeof meta !== 'object') return null
  const sessionConfig = (meta as Record<string, unknown>)['x.ai/sessionConfig']
  if (!sessionConfig || typeof sessionConfig !== 'object') return null
  const options = (sessionConfig as Record<string, unknown>).options
  return Array.isArray(options) ? options : null
}

export function extractModelsFromXaiSessionConfig(meta: unknown): {
  configId: string | null
  models: ModelOption[]
  selectedModelId: string | null
} | null {
  const options = xaiSessionConfigOptions(meta)
  if (!options) return null

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

const EFFORT_ASC_RANK: Record<string, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
}

export function asEffortLevel(raw: string | undefined | null): EffortLevel | undefined {
  const value = raw?.trim().toLowerCase()
  if (!value) return undefined
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
    ? value
    : undefined
}

export function asGrokReasoningEffort(raw: string | undefined | null): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  return value.toLowerCase() in EFFORT_ASC_RANK ? value : undefined
}

function effortRankKey(id: string, name: string): string {
  const fromId = id.trim().toLowerCase()
  if (fromId in EFFORT_ASC_RANK) return fromId
  return name.trim().toLowerCase().replace(/\s+effort$/, '')
}

export function sortEffortModesAscending(modes: ModelOption[]): ModelOption[] {
  return modes
    .map((mode, index) => ({ mode, index, rank: EFFORT_ASC_RANK[effortRankKey(mode.id, mode.name)] }))
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank
      if (a.rank != null) return -1
      if (b.rank != null) return 1
      return a.index - b.index
    })
    .map(({ mode }) => mode)
}

export function extractModesFromXaiSessionConfig(meta: unknown): {
  configId: string | null
  modes: ModelOption[]
  selectedModeId: string | null
} | null {
  const options = xaiSessionConfigOptions(meta)
  if (!options) return null

  const modes: ModelOption[] = []
  let selected: string | null = null
  for (const item of options) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.category !== 'mode') continue
    const id = typeof o.id === 'string' ? o.id : null
    const label = typeof o.label === 'string' ? o.label : id
    if (!id || !label) continue
    modes.push({
      id,
      name: label,
      description: typeof o.description === 'string' ? o.description : '',
    })
    if (o.selected === true) selected = id
  }
  if (modes.length === 0) return null
  const ordered = sortEffortModesAscending(modes)
  return {
    configId: null,
    modes: ordered,
    selectedModeId: selected && ordered.some((m) => m.id === selected) ? selected : (ordered[0]?.id ?? null),
  }
}
