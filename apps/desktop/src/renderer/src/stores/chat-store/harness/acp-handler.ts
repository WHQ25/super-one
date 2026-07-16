import type {
  AcpAgentConfigCatalog,
  AcpAgentModelCatalog,
  AcpConfigOption,
  AcpResources,
  AcpSessionCatalog,
  ModelOption,
} from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState } from '../types'

export function applyAcpResources(
  s: ChatStore,
  r: AcpResources,
): Partial<ChatStore> {
  return {
    harnessResources: { ...s.harnessResources, acp: r },
  }
}

const FALLBACK_ACP_RESOURCES: AcpResources = {
  agents: [
    { id: 'grok-build', name: 'Grok Build', installed: false, commandPreview: 'grok agent stdio' },
    { id: 'opencode', name: 'OpenCode', installed: false, commandPreview: 'opencode acp' },
  ],
  selectedAgentId: null,
  modelsByAgentId: {},
  configByAgentId: {},
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

function extractSelectCategory(
  configOptions: AcpConfigOption[] | undefined,
  category: string,
  idFallback: string,
): { configId: string; options: ModelOption[]; selectedId: string | null } | null {
  if (!configOptions?.length) return null
  const selects = configOptions.filter((o) => o.type === 'select')
  const chosen = selects.find((o) => o.category === category)
    ?? selects.find((o) => o.id === idFallback)
  if (!chosen) return null
  const options = flattenSelectOptions(chosen.options).map((opt) => ({
    id: opt.value,
    name: opt.name,
    description: opt.description,
  }))
  if (options.length === 0) return null
  const selected =
    typeof chosen.currentValue === 'string' && options.some((m) => m.id === chosen.currentValue)
      ? chosen.currentValue
      : (options[0]?.id ?? null)
  return { configId: chosen.id, options, selectedId: selected }
}

function sessionCatalogFromConfig(catalog: AcpAgentConfigCatalog): AcpSessionCatalog {
  const modelFromOptions = extractSelectCategory(catalog.configOptions, 'model', 'model')
  const models = modelFromOptions?.options.length
    ? modelFromOptions.options
    : (catalog.extraModels ?? [])
  const selectedModelId =
    (modelFromOptions?.selectedId
      ?? catalog.selectedModelId
      ?? models[0]?.id
      ?? null)
  const mode = extractSelectCategory(catalog.configOptions, 'mode', 'mode')
  return {
    configOptions: catalog.configOptions,
    models,
    selectedModelId:
      selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : (models[0]?.id ?? null),
    modelConfigId: modelFromOptions?.configId ?? catalog.modelConfigId ?? null,
    modes: mode?.options ?? [],
    selectedModeId: mode?.selectedId ?? null,
    modeConfigId: mode?.configId ?? null,
    slashCommands: catalog.slashCommands ?? [],
    updatedAt: catalog.updatedAt,
  }
}

function sessionCatalogFromLegacyModels(catalog: AcpAgentModelCatalog): AcpSessionCatalog {
  return {
    configOptions: catalog.configId
      ? [{
          id: catalog.configId,
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: catalog.selectedModelId,
          options: catalog.models.map((m) => ({
            value: m.id,
            name: m.name,
            description: m.description || null,
          })),
        }]
      : [],
    models: catalog.models,
    selectedModelId: catalog.selectedModelId,
    modelConfigId: catalog.configId,
    modes: [],
    selectedModeId: null,
    modeConfigId: null,
    slashCommands: [],
    updatedAt: catalog.updatedAt,
  }
}

/** Read-only first paint; config comes from harness_resource_cache (refreshed once per app open). */
export async function connectAcpResources(): Promise<AcpResources> {
  try {
    const startup = await window.app.getStartupData()
    if (startup.cached.acp?.agents?.length) {
      return {
        ...startup.cached.acp,
        modelsByAgentId: startup.cached.acp.modelsByAgentId ?? {},
        configByAgentId: startup.cached.acp.configByAgentId ?? {},
      }
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof window.app.listAcpAgents === 'function') {
      return await window.app.listAcpAgents()
    }
  } catch (err) {
    console.warn('[acp] listAcpAgents failed:', err)
  }
  return FALLBACK_ACP_RESOURCES
}

/** Once-per-launch config probe for installed agents (or a single agentId). */
export async function refreshAcpModels(agentId?: string): Promise<AcpResources | null> {
  try {
    if (typeof window.app.refreshAcpModels !== 'function') return null
    return await window.app.refreshAcpModels(agentId)
  } catch (err) {
    console.warn('[acp] refreshAcpModels failed:', err)
    return null
  }
}

export function getCachedAcpCatalog(
  acp: AcpResources | null | undefined,
  agentId: string | null | undefined,
): AcpSessionCatalog | null {
  if (!acp || !agentId) return null
  const full = acp.configByAgentId?.[agentId]
  if (full && (full.configOptions?.length || full.extraModels?.length || full.slashCommands?.length)) {
    const session = sessionCatalogFromConfig(full)
    if (session.models.length || session.modes.length || session.slashCommands.length) return session
  }
  const legacy = acp.modelsByAgentId?.[agentId]
  if (!legacy?.models?.length) return null
  return sessionCatalogFromLegacyModels(legacy)
}

export function sessionPatchFromAcpCatalog(
  catalog: AcpSessionCatalog | AcpAgentModelCatalog,
  opts?: { preferSelected?: string | null },
): Partial<PerSessionState> {
  const session: AcpSessionCatalog = 'modes' in catalog && 'modelConfigId' in catalog
    ? catalog as AcpSessionCatalog
    : sessionCatalogFromLegacyModels(catalog as AcpAgentModelCatalog)

  const preferred = opts?.preferSelected
  const selected =
    (preferred && session.models.some((m) => m.id === preferred) ? preferred : null)
    ?? session.selectedModelId
    ?? session.models[0]?.id
    ?? ''

  const patch: Partial<PerSessionState> = {
    acpModels: session.models as ModelOption[],
    acpModelConfigId: session.modelConfigId,
    acpModelsStatus: session.models.length > 0 ? 'ready' : 'idle',
    acpModelsError: null,
    selectedModel: selected,
    modelUserChosen: false,
    acpModes: session.modes as ModelOption[],
    acpModeConfigId: session.modeConfigId,
    selectedAcpModeId: session.selectedModeId,
    acpModesStatus: session.modes.length > 0 ? 'ready' : 'idle',
    acpSlashCommands: session.slashCommands,
  }
  return patch
}
