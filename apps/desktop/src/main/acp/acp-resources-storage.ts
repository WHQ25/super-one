import { getCachedHarnessResources, setCachedHarnessResources } from '../database'
import type {
  AcpAgentConfigCatalog,
  AcpAgentModelCatalog,
  AcpConfigOption,
  AcpResources,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { listBuiltinAgentDescriptors, getBuiltinAgent } from './agent-catalog'
import { detectBuiltinAgents } from './acp-detect'
import { discoverAntigravitySlashCommands } from './antigravity-slash-commands'
import { deriveSessionCatalog, modelCatalogFromSession } from './acp-config'

export type AcpProtocolHarnessId = 'acp-grok' | 'acp-antigravity'

export function mergeAcpSlashCommands(
  primary: ReadonlyArray<SlashCommandInfo> | undefined,
  secondary: ReadonlyArray<SlashCommandInfo> | undefined,
): SlashCommandInfo[] | undefined {
  const list = [...(primary ?? []), ...(secondary ?? [])]
  if (list.length === 0) return undefined
  const seen = new Set<string>()
  const out: SlashCommandInfo[] = []
  for (const cmd of list) {
    const name = cmd.name.replace(/^\//, '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ ...cmd, name })
  }
  return out
}

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

export function normalizeAcpResources(raw: AcpResources): AcpResources {
  const configByAgentId = migrateModelsIntoConfig(
    { ...(raw.configByAgentId ?? {}) },
    raw.modelsByAgentId,
  )
  if (configByAgentId.antigravity) {
    configByAgentId.antigravity = {
      ...configByAgentId.antigravity,
      slashCommands: mergeAcpSlashCommands(
        discoverAntigravitySlashCommands(),
        configByAgentId.antigravity.slashCommands,
      ),
    }
  }
  return {
    ...raw,
    configByAgentId,
    modelsByAgentId: deriveModelsByAgentId(configByAgentId),
  }
}

function legacyAcpSlot(): AcpResources | null {
  return getCachedHarnessResources('acp' as 'acp-grok')
}

function slotHasPayload(resources: AcpResources | null | undefined): boolean {
  if (!resources) return false
  return (resources.agents?.length ?? 0) > 0
    || Object.keys(resources.configByAgentId ?? {}).length > 0
    || Object.keys(resources.modelsByAgentId ?? {}).length > 0
    || Boolean(resources.selectedAgentId)
}

function builtinSelected(id: string | null | undefined): string | null {
  return id && getBuiltinAgent(id) ? id : null
}

function filterBuiltinAgents(agents: AcpResources['agents'] | undefined): AcpResources['agents'] {
  return (agents ?? []).filter((agent) => getBuiltinAgent(agent.id))
}

function pickConfig(
  configByAgentId: AcpResources['configByAgentId'] | undefined,
  antigravity: boolean,
): NonNullable<AcpResources['configByAgentId']> {
  const out: NonNullable<AcpResources['configByAgentId']> = {}
  for (const [agentId, catalog] of Object.entries(configByAgentId ?? {})) {
    if (isAntigravityAcpAgent(agentId) === antigravity) out[agentId] = catalog
  }
  return out
}

function mergeSlots(grok: AcpResources | null, antigravity: AcpResources | null): AcpResources | null {
  if (!slotHasPayload(grok) && !slotHasPayload(antigravity)) return null
  const agents = new Map<string, AcpResources['agents'][number]>()
  for (const agent of [...filterBuiltinAgents(grok?.agents), ...filterBuiltinAgents(antigravity?.agents)]) {
    const previous = agents.get(agent.id)
    agents.set(agent.id, previous ? { ...previous, ...agent, installed: previous.installed || agent.installed } : agent)
  }
  return {
    agents: agents.size ? [...agents.values()] : listBuiltinAgentDescriptors(false),
    selectedAgentId: builtinSelected(grok?.selectedAgentId) ?? builtinSelected(antigravity?.selectedAgentId),
    detecting: Boolean(grok?.detecting || antigravity?.detecting),
    modelsByAgentId: { ...(antigravity?.modelsByAgentId ?? {}), ...(grok?.modelsByAgentId ?? {}) },
    configByAgentId: { ...(antigravity?.configByAgentId ?? {}), ...(grok?.configByAgentId ?? {}) },
  }
}

function storedMergedRaw(): AcpResources | null {
  const grok = getCachedHarnessResources('acp-grok')
  const antigravity = getCachedHarnessResources('acp-antigravity')
  if (!slotHasPayload(grok) && !slotHasPayload(antigravity)) return legacyAcpSlot()
  return mergeSlots(grok, antigravity)
}

export function readAcpResourcesCache(): AcpResources {
  const stored = storedMergedRaw()
  if (!stored) return emptyResources()
  const agents = filterBuiltinAgents(stored.agents)
  return normalizeAcpResources({
    agents: agents.length ? agents : listBuiltinAgentDescriptors(false),
    selectedAgentId: builtinSelected(stored.selectedAgentId),
    detecting: stored.detecting,
    modelsByAgentId: stored.modelsByAgentId ?? {},
    configByAgentId: stored.configByAgentId ?? {},
  })
}

function projectSlot(resources: AcpResources, harnessId: AcpProtocolHarnessId): AcpResources {
  const antigravity = harnessId === 'acp-antigravity'
  const selected = builtinSelected(resources.selectedAgentId)
  return normalizeAcpResources({
    agents: filterBuiltinAgents(resources.agents).filter((agent) => isAntigravityAcpAgent(agent.id) === antigravity),
    selectedAgentId: selected && isAntigravityAcpAgent(selected) === antigravity ? selected : null,
    detecting: resources.detecting,
    modelsByAgentId: {},
    configByAgentId: pickConfig(resources.configByAgentId, antigravity),
  })
}

export function readAcpHarnessResources(harnessId: AcpProtocolHarnessId): AcpResources | null {
  const direct = getCachedHarnessResources(harnessId)
  if (slotHasPayload(direct)) {
    return normalizeAcpResources({
      ...direct!,
      agents: filterBuiltinAgents(direct!.agents),
      selectedAgentId: builtinSelected(direct!.selectedAgentId),
      modelsByAgentId: direct!.modelsByAgentId ?? {},
      configByAgentId: direct!.configByAgentId ?? {},
    })
  }
  const grok = getCachedHarnessResources('acp-grok')
  const antigravity = getCachedHarnessResources('acp-antigravity')
  if (slotHasPayload(grok) || slotHasPayload(antigravity)) return null
  const legacy = legacyAcpSlot()
  if (!legacy) return null
  const projected = projectSlot(legacy, harnessId)
  return slotHasPayload(projected) ? projected : null
}

export function writeAcpResourcesCache(resources: AcpResources): void {
  const normalized = normalizeAcpResources(resources)
  const selected = builtinSelected(normalized.selectedAgentId)
  const writeSlot = (harnessId: AcpProtocolHarnessId) => {
    const antigravity = harnessId === 'acp-antigravity'
    setCachedHarnessResources(harnessId, normalizeAcpResources({
      agents: filterBuiltinAgents(normalized.agents).filter((agent) => isAntigravityAcpAgent(agent.id) === antigravity),
      selectedAgentId: selected && isAntigravityAcpAgent(selected) === antigravity ? selected : null,
      detecting: normalized.detecting,
      modelsByAgentId: {},
      configByAgentId: pickConfig(normalized.configByAgentId, antigravity),
    }))
  }
  writeSlot('acp-grok')
  writeSlot('acp-antigravity')
}

export async function refreshAcpDetectedAgents(): Promise<AcpResources> {
  const prev = readAcpResourcesCache()
  const agents = await detectBuiltinAgents()
  const prevSelected = prev.selectedAgentId
  const selectedAgentId = prevSelected && getBuiltinAgent(prevSelected) ? prevSelected : null
  const next = normalizeAcpResources({
    ...prev,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      installed: a.installed,
      commandPreview: a.commandPreview,
    })),
    selectedAgentId,
    modelsByAgentId: prev.modelsByAgentId ?? {},
    configByAgentId: prev.configByAgentId ?? {},
  })
  writeAcpResourcesCache(next)
  return next
}
