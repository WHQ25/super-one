import { homedir } from 'os'
import log from '../logger'
import type {
  AcpAgentConfigCatalog,
  AcpAgentModelCatalog,
  AcpResources,
  AcpSessionCatalog,
  ModelOption,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import { isAcpEffortConfigId, isAcpEffortConfigOption } from '@superone/shared/effort-labels'
import { overlayAcpModelList } from '@superone/shared/harness/acp-mode-catalog'
import { withoutProjectScopedWorkflows } from '@superone/shared/workflow-commands'
import { getBuiltinAgent } from './agent-catalog'
import { createAcpRuntime } from './acp-runtime'
import { discoverAntigravitySlashCommands } from './antigravity-slash-commands'
import {
  deriveSessionCatalog,
  serializeConfigOptions,
  type AcpModeConfig,
  type AcpModelConfig,
  type ConfigOptionLike,
} from './acp-config'
import {
  mergeAcpSlashCommands,
  normalizeAcpResources,
  readAcpHarnessResources,
  readAcpResourcesCache,
  refreshAcpDetectedAgents,
  writeAcpResourcesCache,
} from './acp-resources-storage'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

export {
  readAcpHarnessResources,
  readAcpResourcesCache,
  refreshAcpDetectedAgents,
  writeAcpResourcesCache,
}

const probedThisLaunch = new Set<string>()
const ACP_CATALOG_FRESH_MS = 24 * 60 * 60 * 1000

export function catalogFromModelConfig(cfg: AcpModelConfig): AcpAgentModelCatalog {
  return {
    models: cfg.models,
    selectedModelId: cfg.selectedModelId,
    configId: cfg.configId,
    updatedAt: new Date().toISOString(),
  }
}

export function catalogFromConfigOptions(
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
  modelFallback?: AcpModelConfig | null,
  modeFallback?: AcpModeConfig | null,
): AcpAgentConfigCatalog {
  const serialized = serializeConfigOptions(configOptions)
  const hasModeInOptions = serialized.some((o) => o.category === 'mode' || o.id === 'mode')
  const useExtraModes = Boolean(modeFallback?.modes.length) && !hasModeInOptions
  return {
    configOptions: serialized,
    extraModels:
      modelFallback && modelFallback.models.length > 0
        ? modelFallback.models
        : undefined,
    selectedModelId: modelFallback?.selectedModelId ?? null,
    modelConfigId: modelFallback?.configId ?? null,
    extraModes: useExtraModes ? modeFallback!.modes : undefined,
    selectedModeId: useExtraModes ? (modeFallback!.selectedModeId ?? null) : undefined,
    modeConfigId: useExtraModes ? (modeFallback!.configId ?? null) : undefined,
    updatedAt: new Date().toISOString(),
  }
}

export function upsertAcpAgentConfig(
  agentId: string,
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
  modelFallback?: AcpModelConfig | null,
  modeFallback?: AcpModeConfig | null,
): AcpResources {
  const current = readAcpResourcesCache()
  const catalog = catalogFromConfigOptions(configOptions, modelFallback, modeFallback)
  const prev = current.configByAgentId?.[agentId]
  if (prev && catalog.configOptions.length === 0 && catalog.extraModels?.length && !catalog.extraModes?.length) {
    const merged: AcpAgentConfigCatalog = {
      configOptions: prev.configOptions,
      extraModels: prev.extraModels?.length
        ? overlayAcpModelList(catalog.extraModels, prev.extraModels)
        : catalog.extraModels,
      selectedModelId: catalog.selectedModelId ?? prev.selectedModelId,
      modelConfigId: catalog.modelConfigId ?? prev.modelConfigId,
      extraModes: prev.extraModes,
      selectedModeId: prev.selectedModeId,
      modeConfigId: prev.modeConfigId,
      slashCommands: prev.slashCommands,
      updatedAt: catalog.updatedAt,
    }
    const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: merged }
    const next = normalizeAcpResources({ ...current, configByAgentId })
    writeAcpResourcesCache(next)
    probedThisLaunch.add(agentId)
    return next
  }
  const withCommands: AcpAgentConfigCatalog = mergeAgentCatalog(catalog, prev)
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: withCommands }
  const next = normalizeAcpResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  probedThisLaunch.add(agentId)
  return next
}

export function upsertAcpAgentModes(agentId: string, mode: AcpModeConfig): AcpResources {
  const current = readAcpResourcesCache()
  const prev = current.configByAgentId?.[agentId]
  const nextCatalog: AcpAgentConfigCatalog = {
    configOptions: prev?.configOptions ?? [],
    extraModels: prev?.extraModels,
    selectedModelId: prev?.selectedModelId ?? null,
    modelConfigId: prev?.modelConfigId ?? null,
    extraModes: mode.modes,
    selectedModeId: mode.selectedModeId,
    modeConfigId: mode.configId,
    slashCommands: prev?.slashCommands,
    updatedAt: new Date().toISOString(),
  }
  if (mode.configId && !isAcpEffortConfigId(mode.configId)) {
    const withoutMode = (prev?.configOptions ?? []).filter(
      (o) => o.category !== 'mode' && o.id !== 'mode' && o.id !== mode.configId && !isAcpEffortConfigOption(o),
    )
    nextCatalog.configOptions = [
      ...withoutMode,
      {
        id: mode.configId,
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: mode.selectedModeId,
        options: mode.modes.map((m) => ({
          value: m.id,
          name: m.name,
          description: m.description || null,
        })),
      },
    ]
    nextCatalog.extraModes = undefined
    nextCatalog.modeConfigId = mode.configId
  } else {
    const withoutEffort = (prev?.configOptions ?? []).filter(
      (o) => o.category !== 'mode' && o.id !== 'mode' && !isAcpEffortConfigOption(o),
    )
    nextCatalog.configOptions = mode.configId
      ? [
          ...withoutEffort,
          {
            id: mode.configId,
            name: 'Reasoning Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: mode.selectedModeId,
            options: mode.modes.map((m) => ({
              value: m.id,
              name: m.name,
              description: m.description || null,
            })),
          },
        ]
      : withoutEffort
    nextCatalog.extraModes = mode.modes
    nextCatalog.modeConfigId = mode.configId
  }
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: nextCatalog }
  const next = normalizeAcpResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  return next
}

export function upsertAcpAgentModels(agentId: string, cfg: AcpModelConfig): AcpResources {
  if (cfg.configId) {
    return upsertAcpAgentConfig(agentId, [{
      id: cfg.configId,
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: cfg.selectedModelId,
      options: cfg.models.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description || null,
      })),
    }], cfg)
  }
  return upsertAcpAgentConfig(agentId, [], cfg)
}

export function upsertAcpAgentSlashCommands(
  agentId: string,
  commands: SlashCommandInfo[],
): AcpResources {
  const current = readAcpResourcesCache()
  const prev = current.configByAgentId?.[agentId]
  const nextCatalog: AcpAgentConfigCatalog = {
    configOptions: prev?.configOptions ?? [],
    extraModels: prev?.extraModels,
    selectedModelId: prev?.selectedModelId ?? null,
    modelConfigId: prev?.modelConfigId ?? null,
    extraModes: prev?.extraModes,
    selectedModeId: prev?.selectedModeId,
    modeConfigId: prev?.modeConfigId,
    slashCommands: withoutProjectScopedWorkflows(commands),
    updatedAt: new Date().toISOString(),
  }
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: nextCatalog }
  const next = normalizeAcpResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  return next
}

function mergeAgentCatalog(
  next: AcpAgentConfigCatalog,
  prev: AcpAgentConfigCatalog | undefined,
): AcpAgentConfigCatalog {
  if (!prev) return next
  const nextHasModes = Boolean(next.extraModes?.length)
    || next.configOptions.some(
      (o) => o.category === 'mode' || o.id === 'mode' || isAcpEffortConfigOption(o),
    )
  return {
    configOptions: next.configOptions.length ? next.configOptions : prev.configOptions,
    extraModels: next.extraModels?.length
      ? (prev.extraModels?.length ? overlayAcpModelList(next.extraModels, prev.extraModels) : next.extraModels)
      : prev.extraModels,
    selectedModelId: next.selectedModelId ?? prev.selectedModelId ?? null,
    modelConfigId: next.modelConfigId ?? prev.modelConfigId ?? null,
    extraModes: next.extraModes?.length ? next.extraModes : prev.extraModes,
    selectedModeId: nextHasModes
      ? (next.selectedModeId ?? prev.selectedModeId ?? null)
      : (prev.selectedModeId ?? null),
    modeConfigId: nextHasModes
      ? (next.modeConfigId ?? null)
      : (prev.modeConfigId ?? null),
    slashCommands: mergeAcpSlashCommands(next.slashCommands, prev.slashCommands),
    updatedAt: next.updatedAt,
  }
}

function catalogHasContent(cat: AcpAgentConfigCatalog | undefined): boolean {
  if (!cat) return false
  return (
    (cat.configOptions?.length ?? 0) > 0
    || (cat.extraModels?.length ?? 0) > 0
    || (cat.extraModes?.length ?? 0) > 0
  )
}

function isCatalogFresh(agentId: string, cat: AcpAgentConfigCatalog | undefined): boolean {
  if (!catalogHasContent(cat) || !cat?.updatedAt) return false
  if (agentId === 'antigravity') {
    const session = deriveSessionCatalog(cat)
    const hasNonGemini = session.models.some((m) => !m.id.toLowerCase().startsWith('gemini-'))
    const hasEffortMetadata = session.models.some(
      (m) => m.supportsEffort !== undefined || m.supportedEffortLevels !== undefined,
    )
    if (!hasNonGemini || !hasEffortMetadata) return false
  }
  const age = Date.now() - Date.parse(cat.updatedAt)
  return Number.isFinite(age) && age >= 0 && age < ACP_CATALOG_FRESH_MS
}

async function probeAgentConfig(agentId: string): Promise<AcpAgentConfigCatalog | null> {
  const def = getBuiltinAgent(agentId)
  if (!def) return null
  const cwd = homedir()
  log.info('[acp-model-cache] probe start agent=%s', agentId)

  const runtime = await createAcpRuntime({
    launch: {
      agentId,
      command: def.command,
      args: def.args,
      defaultCwd: cwd,
    },
    permission: {
      request: async () => ({ outcome: { outcome: 'cancelled' as const } }),
    },
  })
  try {
    const options = runtime.getConfigOptions()
    const modelCfg = runtime.getModelConfig()
    const modeCfg = runtime.getModeConfig()
    const prev = readAcpResourcesCache().configByAgentId?.[agentId]
    const hasConfig =
      (options?.length ?? 0) > 0
      || (modelCfg?.models.length ?? 0) > 0
      || (modeCfg?.modes.length ?? 0) > 0
    if (!hasConfig && !prev) {
      log.info('[acp-model-cache] probe empty agent=%s', agentId)
      return null
    }

    const catalog = mergeAgentCatalog(catalogFromConfigOptions(options, modelCfg, modeCfg), prev)
    if (agentId === 'antigravity' && (!catalog.slashCommands || catalog.slashCommands.length === 0)) {
      catalog.slashCommands = discoverAntigravitySlashCommands()
    }
    const session = deriveSessionCatalog(catalog)
    log.info(
      '[acp-model-cache] probe ok agent=%s configOptions=%d models=%d modes=%d modeConfigId=%s',
      agentId,
      catalog.configOptions.length,
      session.models.length,
      session.modes.length,
      session.modeConfigId ?? 'null',
    )
    return catalog
  } finally {
    try { await runtime.close() } catch { void 0 }
  }
}

export function resolveAcpProbeTargets(
  resources: AcpResources,
  opts?: { agentIds?: string[] },
): Array<{ id: string; name: string; installed: boolean; commandPreview: string }> {
  const installed = resources.agents.filter((a) => a.installed)
  if (opts?.agentIds?.length) {
    const want = new Set(opts.agentIds)
    return installed.filter((a) => want.has(a.id))
  }
  const selected = resources.selectedAgentId
  if (!selected) return []
  return installed.filter((a) => a.id === selected)
}

export async function refreshAcpModelsOnce(opts?: {
  agentIds?: string[]
  force?: boolean
}): Promise<AcpResources> {
  const current = readAcpResourcesCache()
  const configByAgentId = { ...(current.configByAgentId ?? {}) }
  const targets = resolveAcpProbeTargets(current, opts)

  await Promise.all(targets.map(async (agent) => {
    if (!opts?.force && probedThisLaunch.has(agent.id)) return
    if (!opts?.force && isCatalogFresh(agent.id, configByAgentId[agent.id])) {
      probedThisLaunch.add(agent.id)
      log.info('[acp-model-cache] skip fresh cache agent=%s', agent.id)
      return
    }
    probedThisLaunch.add(agent.id)
    try {
      const catalog = await probeAgentConfig(agent.id)
      if (catalog) {
        configByAgentId[agent.id] = mergeAgentCatalog(catalog, configByAgentId[agent.id])
      }
    } catch (err) {
      log.warn(
        '[acp-model-cache] probe failed agent=%s: %s',
        agent.id,
        err instanceof Error ? err.message : String(err),
      )
    }
  }))

  const next = normalizeAcpResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  return next
}

export function getCachedModelsForAgent(agentId: string): {
  models: ModelOption[]
  selectedModelId: string | null
  configId: string | null
} | null {
  const session = getCachedSessionCatalog(agentId)
  if (!session?.models.length) return null
  return {
    models: session.models,
    selectedModelId: session.selectedModelId,
    configId: session.modelConfigId,
  }
}

export function getCachedSessionCatalog(agentId: string): AcpSessionCatalog | null {
  const cat = readAcpResourcesCache().configByAgentId?.[agentId]
  if (!cat) return null
  const session = deriveSessionCatalog(cat)
  if (
    !session.models.length
    && !session.modes.length
    && !session.configOptions.length
    && !session.slashCommands.length
  ) {
    return null
  }
  return session
}

export function resetAcpModelProbeStateForTests(): void {
  probedThisLaunch.clear()
}
