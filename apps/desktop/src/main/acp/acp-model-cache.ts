import { homedir } from 'os'
import log from '../logger'
import { getCachedHarnessResources, setCachedHarnessResources } from '../database'
import type { AcpAgentModelCatalog, AcpResources, ModelOption } from '@superone/shared/agent-types'
import { listBuiltinAgentDescriptors, getBuiltinAgent } from './agent-catalog'
import { createAcpRuntime } from './acp-runtime'
import type { AcpModelConfig } from './acp-config'

/** Agents already probed for models during this process lifetime. */
const probedThisLaunch = new Set<string>()

function emptyResources(selectedAgentId: string | null = null): AcpResources {
  return {
    agents: listBuiltinAgentDescriptors(false),
    selectedAgentId,
    modelsByAgentId: {},
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
  return {
    agents: agents.length ? agents : listBuiltinAgentDescriptors(false),
    selectedAgentId,
    detecting: cached.detecting,
    modelsByAgentId: cached.modelsByAgentId ?? {},
  }
}

export function writeAcpResourcesCache(resources: AcpResources): void {
  setCachedHarnessResources('acp', resources)
}

export function catalogFromModelConfig(cfg: AcpModelConfig): AcpAgentModelCatalog {
  return {
    models: cfg.models,
    selectedModelId: cfg.selectedModelId,
    configId: cfg.configId,
    updatedAt: new Date().toISOString(),
  }
}

/** Merge a live model discovery into the persistent ACP cache. */
export function upsertAcpAgentModels(agentId: string, cfg: AcpModelConfig): AcpResources {
  const current = readAcpResourcesCache()
  const catalog = catalogFromModelConfig(cfg)
  const modelsByAgentId = { ...(current.modelsByAgentId ?? {}), [agentId]: catalog }
  const next: AcpResources = { ...current, modelsByAgentId }
  writeAcpResourcesCache(next)
  probedThisLaunch.add(agentId)
  return next
}

async function probeAgentModels(agentId: string): Promise<AcpAgentModelCatalog | null> {
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
    const cfg = runtime.getModelConfig()
    if (!cfg || cfg.models.length === 0) {
      log.info('[acp-model-cache] probe empty agent=%s', agentId)
      return null
    }
    log.info('[acp-model-cache] probe ok agent=%s models=%d', agentId, cfg.models.length)
    return catalogFromModelConfig(cfg)
  } finally {
    try { await runtime.close() } catch { /* ignore */ }
  }
}

/**
 * Refresh model catalogs for installed agents once per app open.
 * Returns immediately-usable resources (previous cache + any successful probes).
 */
export async function refreshAcpModelsOnce(opts?: {
  agentIds?: string[]
  force?: boolean
}): Promise<AcpResources> {
  const current = readAcpResourcesCache()
  const modelsByAgentId = { ...(current.modelsByAgentId ?? {}) }
  const targets = (opts?.agentIds?.length
    ? current.agents.filter((a) => opts.agentIds!.includes(a.id))
    : current.agents
  ).filter((a) => a.installed)

  await Promise.all(targets.map(async (agent) => {
    if (!opts?.force && probedThisLaunch.has(agent.id)) return
    probedThisLaunch.add(agent.id)
    try {
      const catalog = await probeAgentModels(agent.id)
      if (catalog) modelsByAgentId[agent.id] = catalog
    } catch (err) {
      log.warn(
        '[acp-model-cache] probe failed agent=%s: %s',
        agent.id,
        err instanceof Error ? err.message : String(err),
      )
      // Keep previous catalog if any.
    }
  }))

  const next: AcpResources = { ...current, modelsByAgentId }
  writeAcpResourcesCache(next)
  return next
}

export function getCachedModelsForAgent(agentId: string): {
  models: ModelOption[]
  selectedModelId: string | null
  configId: string | null
} | null {
  const catalog = readAcpResourcesCache().modelsByAgentId?.[agentId]
  if (!catalog?.models?.length) return null
  return {
    models: catalog.models,
    selectedModelId: catalog.selectedModelId,
    configId: catalog.configId,
  }
}

/** Test helper. */
export function resetAcpModelProbeStateForTests(): void {
  probedThisLaunch.clear()
}
