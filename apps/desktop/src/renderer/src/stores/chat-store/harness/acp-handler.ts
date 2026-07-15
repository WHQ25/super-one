import type { AcpAgentModelCatalog, AcpResources, ModelOption } from '@superone/shared/agent-types'
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
}

/** Read-only first paint; models come from harness_resource_cache (refreshed once per app open). */
export async function connectAcpResources(): Promise<AcpResources> {
  try {
    const startup = await window.app.getStartupData()
    if (startup.cached.acp?.agents?.length) {
      return {
        ...startup.cached.acp,
        modelsByAgentId: startup.cached.acp.modelsByAgentId ?? {},
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

/** Once-per-launch model probe for installed agents (or a single agentId). */
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
): AcpAgentModelCatalog | null {
  if (!acp || !agentId) return null
  const catalog = acp.modelsByAgentId?.[agentId]
  if (!catalog?.models?.length) return null
  return catalog
}

export function sessionPatchFromAcpCatalog(
  catalog: AcpAgentModelCatalog,
  opts?: { preferSelected?: string | null },
): Partial<PerSessionState> {
  const preferred = opts?.preferSelected
  const selected =
    (preferred && catalog.models.some((m) => m.id === preferred) ? preferred : null)
    ?? catalog.selectedModelId
    ?? catalog.models[0]?.id
    ?? ''
  return {
    acpModels: catalog.models as ModelOption[],
    acpModelConfigId: catalog.configId,
    acpModelsStatus: 'ready',
    acpModelsError: null,
    selectedModel: selected,
    modelUserChosen: false,
  }
}
