import { homedir } from 'os'
import log from '../logger'
import { getCachedHarnessResources, setCachedHarnessResources } from '../database'
import type {
  AcpAgentConfigCatalog,
  AcpAgentModelCatalog,
  AcpConfigOption,
  AcpResources,
  AcpSessionCatalog,
  ModelOption,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import { listBuiltinAgentDescriptors, getBuiltinAgent } from './agent-catalog'
import { createAcpRuntime } from './acp-runtime'
import {
  deriveSessionCatalog,
  modelCatalogFromSession,
  serializeConfigOptions,
  type AcpModeConfig,
  type AcpModelConfig,
  type ConfigOptionLike,
} from './acp-config'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

/** Agents already probed for config during this process lifetime. */
const probedThisLaunch = new Set<string>()

function emptyResources(selectedAgentId: string | null = null): AcpResources {
  return {
    agents: listBuiltinAgentDescriptors(false),
    selectedAgentId,
    modelsByAgentId: {},
    configByAgentId: {},
  }
}

function deriveModelsByAgentId(
  configByAgentId: Record<string, AcpAgentConfigCatalog>,
): Record<string, AcpAgentModelCatalog> {
  const out: Record<string, AcpAgentModelCatalog> = {}
  for (const [agentId, cat] of Object.entries(configByAgentId)) {
    const session = deriveSessionCatalog(cat)
    const models = modelCatalogFromSession(session)
    if (models) out[agentId] = models
  }
  return out
}

/** Migrate legacy modelsByAgentId entries into configByAgentId when missing. */
function migrateModelsIntoConfig(
  configByAgentId: Record<string, AcpAgentConfigCatalog>,
  modelsByAgentId: Record<string, AcpAgentModelCatalog> | undefined,
): Record<string, AcpAgentConfigCatalog> {
  if (!modelsByAgentId) return configByAgentId
  const next = { ...configByAgentId }
  for (const [agentId, models] of Object.entries(modelsByAgentId)) {
    if (next[agentId] || !models.models?.length) continue
    const configOptions: AcpConfigOption[] = models.configId
      ? [{
          id: models.configId,
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: models.selectedModelId,
          options: models.models.map((m) => ({
            value: m.id,
            name: m.name,
            description: m.description || null,
          })),
        }]
      : []
    next[agentId] = {
      configOptions,
      extraModels: models.configId ? undefined : models.models,
      selectedModelId: models.selectedModelId,
      modelConfigId: models.configId,
      updatedAt: models.updatedAt || new Date().toISOString(),
    }
  }
  return next
}

function normalizeResources(raw: AcpResources): AcpResources {
  const configByAgentId = migrateModelsIntoConfig(
    { ...(raw.configByAgentId ?? {}) },
    raw.modelsByAgentId,
  )
  return {
    ...raw,
    configByAgentId,
    modelsByAgentId: deriveModelsByAgentId(configByAgentId),
  }
}

export function readAcpResourcesCache(): AcpResources {
  const cached = getCachedHarnessResources('acp')
  if (!cached) return emptyResources()
  const agents = (cached.agents ?? []).filter((a) => getBuiltinAgent(a.id) || a.id === 'custom')
  const selectedAgentId =
    cached.selectedAgentId && (getBuiltinAgent(cached.selectedAgentId) || cached.selectedAgentId === 'custom')
      ? cached.selectedAgentId
      : null
  return normalizeResources({
    agents: agents.length ? agents : listBuiltinAgentDescriptors(false),
    selectedAgentId,
    detecting: cached.detecting,
    modelsByAgentId: cached.modelsByAgentId ?? {},
    configByAgentId: cached.configByAgentId ?? {},
  })
}

export function writeAcpResourcesCache(resources: AcpResources): void {
  setCachedHarnessResources('acp', normalizeResources(resources))
}

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
  const hasModelInOptions = serialized.some((o) => o.category === 'model' || o.id === 'model')
  const hasModeInOptions = serialized.some((o) => o.category === 'mode' || o.id === 'mode')
  const useExtraModes = Boolean(modeFallback?.modes.length) && !hasModeInOptions
  return {
    configOptions: serialized,
    extraModels:
      modelFallback && modelFallback.models.length > 0 && !hasModelInOptions
        ? modelFallback.models
        : undefined,
    selectedModelId: modelFallback?.selectedModelId ?? null,
    modelConfigId: modelFallback?.configId ?? null,
    // Grok effort options live outside configOptions (configId null).
    extraModes: useExtraModes ? modeFallback!.modes : undefined,
    selectedModeId: useExtraModes ? (modeFallback!.selectedModeId ?? null) : undefined,
    modeConfigId: useExtraModes ? (modeFallback!.configId ?? null) : undefined,
    updatedAt: new Date().toISOString(),
  }
}

/** Merge a live full-config discovery into the persistent ACP cache. */
export function upsertAcpAgentConfig(
  agentId: string,
  configOptions: Array<ConfigOptionLike | SessionConfigOption> | null | undefined,
  modelFallback?: AcpModelConfig | null,
  modeFallback?: AcpModeConfig | null,
): AcpResources {
  const current = readAcpResourcesCache()
  const catalog = catalogFromConfigOptions(configOptions, modelFallback, modeFallback)
  // Keep previous modes/commands if new payload has empty options but we only got a model-only update.
  const prev = current.configByAgentId?.[agentId]
  if (prev && catalog.configOptions.length === 0 && catalog.extraModels?.length && !catalog.extraModes?.length) {
    const merged: AcpAgentConfigCatalog = {
      configOptions: prev.configOptions,
      extraModels: catalog.extraModels,
      selectedModelId: catalog.selectedModelId ?? prev.selectedModelId,
      modelConfigId: catalog.modelConfigId ?? prev.modelConfigId,
      extraModes: prev.extraModes,
      selectedModeId: prev.selectedModeId,
      modeConfigId: prev.modeConfigId,
      slashCommands: prev.slashCommands,
      updatedAt: catalog.updatedAt,
    }
    const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: merged }
    const next = normalizeResources({ ...current, configByAgentId })
    writeAcpResourcesCache(next)
    probedThisLaunch.add(agentId)
    return next
  }
  // Preserve slash commands (and Grok extraModes when this upsert is options-only).
  const withCommands: AcpAgentConfigCatalog = mergeAgentCatalog(catalog, prev)
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: withCommands }
  const next = normalizeResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  probedThisLaunch.add(agentId)
  return next
}

/** Persist Grok-style effort modes (modeConfigId null) without wiping models. */
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
  // When modes use a real setConfigOption id, prefer configOptions form.
  if (mode.configId) {
    const withoutMode = (prev?.configOptions ?? []).filter(
      (o) => o.category !== 'mode' && o.id !== 'mode' && o.id !== mode.configId,
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
    // Strip any previously faked mode configOptions so derive keeps modeConfigId null.
    nextCatalog.configOptions = (prev?.configOptions ?? []).filter(
      (o) => o.category !== 'mode' && o.id !== 'mode',
    )
  }
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: nextCatalog }
  const next = normalizeResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  return next
}

/** @deprecated Prefer upsertAcpAgentConfig — still used for model-only Grok updates. */
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

/** Merge slash commands from available_commands_update into the agent config cache. */
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
    slashCommands: commands,
    updatedAt: new Date().toISOString(),
  }
  const configByAgentId = { ...(current.configByAgentId ?? {}), [agentId]: nextCatalog }
  const next = normalizeResources({ ...current, configByAgentId })
  writeAcpResourcesCache(next)
  return next
}

function mergeAgentCatalog(
  next: AcpAgentConfigCatalog,
  prev: AcpAgentConfigCatalog | undefined,
): AcpAgentConfigCatalog {
  if (!prev) return next
  const nextHasModes = Boolean(next.extraModes?.length)
    || next.configOptions.some((o) => o.category === 'mode' || o.id === 'mode')
  return {
    configOptions: next.configOptions.length ? next.configOptions : prev.configOptions,
    extraModels: next.extraModels?.length ? next.extraModels : prev.extraModels,
    selectedModelId: next.selectedModelId ?? prev.selectedModelId ?? null,
    modelConfigId: next.modelConfigId ?? prev.modelConfigId ?? null,
    // Preserve Grok effort modes across model-only / empty probes.
    extraModes: next.extraModes?.length ? next.extraModes : prev.extraModes,
    selectedModeId: nextHasModes
      ? (next.selectedModeId ?? prev.selectedModeId ?? null)
      : (prev.selectedModeId ?? null),
    // null is meaningful (Grok effort); only fall back when next has no mode signal.
    modeConfigId: nextHasModes
      ? (next.modeConfigId ?? null)
      : (prev.modeConfigId ?? null),
    // Slash commands are loaded lazily when the user opens the / popup — never
    // collected during startup model/config probe. Always preserve cached ones.
    slashCommands: prev.slashCommands,
    updatedAt: next.updatedAt,
  }
}

/**
 * Startup probe for models/modes only. Slash commands are intentionally not
 * waited on here — they load when the user first opens the ACP / popup.
 */
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
    try { await runtime.close() } catch { /* ignore */ }
  }
}

/**
 * Refresh model/mode catalogs for installed agents once per app open.
 * Does not probe slash commands (lazy, on first / popup open).
 */
export async function refreshAcpModelsOnce(opts?: {
  agentIds?: string[]
  force?: boolean
}): Promise<AcpResources> {
  const current = readAcpResourcesCache()
  const configByAgentId = { ...(current.configByAgentId ?? {}) }
  const targets = (opts?.agentIds?.length
    ? current.agents.filter((a) => opts.agentIds!.includes(a.id))
    : current.agents
  ).filter((a) => a.installed)

  await Promise.all(targets.map(async (agent) => {
    if (!opts?.force && probedThisLaunch.has(agent.id)) return
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

  const next = normalizeResources({ ...current, configByAgentId })
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

/** Test helper. */
export function resetAcpModelProbeStateForTests(): void {
  probedThisLaunch.clear()
}
