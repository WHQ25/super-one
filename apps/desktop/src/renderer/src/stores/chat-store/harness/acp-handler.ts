import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import type {
  AcpAgentConfigCatalog,
  AcpAgentModelCatalog,
  AcpConfigOption,
  AcpResources,
  AcpSessionCatalog,
  ModelOption,
} from '@superone/shared/agent-types'
import { isAcpEffortConfigOption, sortEffortsAscending } from '@superone/shared/effort-labels'
import { acpAgentDefaultsFor } from '@superone/shared/harness/session-defaults'
import { withoutProjectScopedWorkflows } from '@superone/shared/workflow-commands'
import { projectAntigravityModels } from '@/harness-ui/acp/model-options'
import { defaultPrefsCache } from '../helpers/prefs-cache'
import { resolveProvider, type ProviderResolvableSession } from '../helpers/provider-routing'
import type { ChatStore, PerSessionState } from '../types'

/** Grok and Antigravity share this harness. The id comparison stays in this module. */
export function sessionUsesAcpHarness(session: ProviderResolvableSession): boolean {
  return resolveProvider(session) === 'acp'
}

export function applyAcpResources(
  s: ChatStore,
  r: AcpResources,
): Partial<ChatStore> {
  let projectSessions = s.projectSessions
  for (const [projectPath, ps] of Object.entries(s.projectSessions ?? {})) {
    let sessionsChanged = false
    const nextSessions: Record<string, PerSessionState> = { ...ps._sessions }
    for (const [sessionId, session] of Object.entries(ps._sessions ?? {})) {
      const isAcp = (session.sessionProvider || session.preferredProvider) === 'acp'
      if (!isAcp || !session.acpAgentId) continue
      const catalog = getCachedAcpCatalog(r, session.acpAgentId)
      if (!catalog) continue
      const needsModels = session.acpModels.length === 0 && catalog.models.length > 0
      const needsModes = session.acpModes.length === 0 && catalog.modes.length > 0
      const needsSlash = session.acpSlashCommands.length === 0 && catalog.slashCommands.length > 0
      if (!needsModels && !needsModes && !needsSlash) continue
      sessionsChanged = true
      nextSessions[sessionId] = {
        ...session,
        ...(needsModels
          ? sessionPatchFromAcpCatalog(catalog, {
              preferSelected: session.selectedModel || null,
              preferModeId: session.selectedAcpModeId || null,
              agentId: session.acpAgentId,
            })
          : {
              ...(needsModes
                ? {
                    acpModes: catalog.modes,
                    acpModeConfigId: catalog.modeConfigId,
                    selectedAcpModeId: session.selectedAcpModeId ?? catalog.selectedModeId,
                    acpModesStatus: 'ready' as const,
                  }
                : {}),
              ...(needsSlash
                ? {
                    acpSlashCommands: catalog.slashCommands,
                    acpSlashCommandsStatus: 'ready' as const,
                  }
                : {}),
            }),
      }
    }
    if (sessionsChanged) {
      if (projectSessions === s.projectSessions) projectSessions = { ...s.projectSessions }
      projectSessions[projectPath] = { ...ps, _sessions: nextSessions }
    }
  }
  return {
    harnessResources: { ...s.harnessResources, acp: r },
    ...(projectSessions !== s.projectSessions ? { projectSessions } : {}),
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
  const names = new Set<string>()
  const options = flattenSelectOptions(chosen.options).map((opt) => {
    const baseName = opt.name.trim() ? opt.name : opt.value
    const name =
      category === 'model' && names.has(baseName) ? `${baseName} (${opt.value})` : baseName
    names.add(baseName)
    return {
      id: opt.value,
      name,
      description: opt.description,
    }
  })
  if (options.length === 0) return null
  const selected =
    typeof chosen.currentValue === 'string' && options.some((m) => m.id === chosen.currentValue)
      ? chosen.currentValue
      : (options[0]?.id ?? null)
  return { configId: chosen.id, options, selectedId: selected }
}

function extractReasoningEffort(
  configOptions: AcpConfigOption[] | undefined,
): { configId: string; options: ModelOption[]; selectedId: string | null } | null {
  const chosen = configOptions?.find((option) => option.type === 'select' && isAcpEffortConfigOption(option))
  if (!chosen) return null
  const extracted = extractSelectCategory([chosen], chosen.category ?? 'thought_level', chosen.id)
  if (!extracted) return null
  const options = sortEffortsAscending(extracted.options.map((mode) => ({
    value: mode.id,
    label: mode.name,
    mode,
  }))).map((item) => item.mode)
  return { ...extracted, options }
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
  // Grok thought_level stays an effort catalog. OpenCode category=mode stays a session mode.
  const effort = extractReasoningEffort(catalog.configOptions)
  const mode = effort ?? extractSelectCategory(catalog.configOptions, 'mode', 'mode')
  // Prefer configOptions; else Grok-style extraModes (modeConfigId may be null).
  const modes = mode?.options.length ? mode.options : (catalog.extraModes ?? [])
  const selectedModeId = mode?.selectedId
    ?? (catalog.selectedModeId && modes.some((m) => m.id === catalog.selectedModeId)
      ? catalog.selectedModeId
      : null)
    ?? modes[0]?.id
    ?? null
  const modeConfigId = mode?.configId
    ?? (modes.length > 0 ? (catalog.modeConfigId ?? null) : null)
  return {
    configOptions: catalog.configOptions,
    models,
    selectedModelId:
      selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : (models[0]?.id ?? null),
    modelConfigId: modelFromOptions?.configId ?? catalog.modelConfigId ?? null,
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
export async function connectAcpResources(opts?: { force?: boolean }): Promise<AcpResources> {
  if (!opts?.force) {
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
  if (
    full
    && (
      full.configOptions?.length
      || full.extraModels?.length
      || full.extraModes?.length
      || full.slashCommands?.length
    )
  ) {
    const session = sessionCatalogFromConfig(full)
    if (session.models.length || session.modes.length || session.slashCommands.length) return session
  }
  const legacy = acp.modelsByAgentId?.[agentId]
  if (!legacy?.models?.length) return null
  return sessionCatalogFromLegacyModels(legacy)
}

function resolveDefaultAcpModelAndMode(
  session: AcpSessionCatalog,
  opts?: {
    preferSelected?: string | null
    preferModeId?: string | null
    agentId?: string | null
  },
): { selectedModel: string; selectedModeId: string | null } {
  const agentId = opts?.agentId
  const defaults = acpAgentDefaultsFor(defaultPrefsCache.agentPreference?.acp, agentId)
  const preferred = opts?.preferSelected
  const preferredModel = preferred && session.models.some((m) => m.id === preferred) ? preferred : null

  const preferMode = opts?.preferModeId
  const preferredMode = preferMode && session.modes.some((m) => m.id === preferMode) ? preferMode : null
  const configuredMode = defaults.defaultEffort && session.modes.some((m) => m.id === defaults.defaultEffort)
    ? defaults.defaultEffort
    : null
  const selectedModeId = preferredMode ?? configuredMode ?? session.selectedModeId

  if (isAntigravityAcpAgent(agentId)) {
    if (preferredModel) {
      return { selectedModel: preferredModel, selectedModeId }
    }
    if ((defaults.defaultModel || defaults.defaultEffort) && session.models.length > 0) {
      const projected = projectAntigravityModels(
        session.models as ModelOption[],
        defaults.defaultModel || session.selectedModelId || session.models[0]?.id || null,
        defaults.defaultEffort || null,
      )
      const resolvedId = projected.selectedBaseModelId
        ? projected.resolveModelId(projected.selectedBaseModelId, defaults.defaultEffort || null)
        : null
      if (resolvedId && session.models.some((m) => m.id === resolvedId)) {
        return { selectedModel: resolvedId, selectedModeId }
      }
      if (defaults.defaultModel && session.models.some((m) => m.id === defaults.defaultModel)) {
        return { selectedModel: defaults.defaultModel, selectedModeId }
      }
    }
    return {
      selectedModel: session.selectedModelId ?? session.models[0]?.id ?? '',
      selectedModeId,
    }
  }

  const configuredModel = defaults.defaultModel && session.models.some((m) => m.id === defaults.defaultModel)
    ? defaults.defaultModel
    : null
  const selectedModel = preferredModel
    ?? configuredModel
    ?? session.selectedModelId
    ?? session.models[0]?.id
    ?? ''

  return { selectedModel, selectedModeId }
}

export function sessionPatchFromAcpCatalog(
  catalog: AcpSessionCatalog | AcpAgentModelCatalog,
  opts?: {
    preferSelected?: string | null
    preferModeId?: string | null
    agentId?: string | null
  },
): Partial<PerSessionState> {
  const session: AcpSessionCatalog = 'modes' in catalog && 'modelConfigId' in catalog
    ? catalog as AcpSessionCatalog
    : sessionCatalogFromLegacyModels(catalog as AcpAgentModelCatalog)

  const { selectedModel, selectedModeId } = resolveDefaultAcpModelAndMode(session, opts)

  const patch: Partial<PerSessionState> = {
    acpModels: session.models as ModelOption[],
    acpModelConfigId: session.modelConfigId,
    acpModelsStatus: session.models.length > 0 ? 'ready' : 'idle',
    acpModelsError: null,
    selectedModel,
    modelUserChosen: false,
    acpModes: session.modes as ModelOption[],
    acpModeConfigId: session.modeConfigId,
    selectedAcpModeId: selectedModeId,
    acpModesStatus: session.modes.length > 0 ? 'ready' : 'idle',
    acpSlashCommands: session.slashCommands,
    acpSlashCommandsStatus: session.slashCommands.length > 0 ? 'ready' : 'idle',
  }
  return patch
}
