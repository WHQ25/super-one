import {
  acpAgentIdForHarness,
  isAntigravityAcpAgent,
  isOpenCodeAcpAgent,
} from '@superone/shared/acp-brand'
import type { AcpResources } from '@superone/shared/agent-types'

export type AcpHarnessId = 'acp-grok' | 'acp-antigravity'

export interface AcpResourceSlots {
  'acp-grok': AcpResources | null
  'acp-antigravity': AcpResources | null
}

export function acpHarnessForAgent(agentId: string | null | undefined): AcpHarnessId {
  return isAntigravityAcpAgent(agentId) ? 'acp-antigravity' : 'acp-grok'
}

export function acpResourcesFor(
  resources: AcpResourceSlots,
  harnessOrAgent: AcpHarnessId | string | null | undefined,
): AcpResources | null {
  const harness = harnessOrAgent === 'acp-grok' || harnessOrAgent === 'acp-antigravity'
    ? harnessOrAgent
    : acpHarnessForAgent(harnessOrAgent)
  return resources[harness]
}

function pickMap<T>(
  map: Record<string, T> | undefined,
  keep: (id: string) => boolean,
): Record<string, T> {
  if (!map) return {}
  const out: Record<string, T> = {}
  for (const [id, value] of Object.entries(map)) {
    if (keep(id)) out[id] = value
  }
  return out
}

function slotHasData(agents: AcpResources['agents'], models: Record<string, unknown>, config: Record<string, unknown>): boolean {
  return agents.length > 0 || Object.keys(models).length > 0 || Object.keys(config).length > 0
}

export function splitLegacyAcpResources(
  blob: AcpResources | null | undefined,
): Partial<Record<AcpHarnessId, AcpResources>> {
  if (!blob) return {}
  const agents = blob.agents ?? []
  const keepGrok = (id: string) => !isAntigravityAcpAgent(id) && !isOpenCodeAcpAgent(id)
  const grokAgents = agents.filter((agent) => keepGrok(agent.id))
  const antiAgents = agents.filter((agent) => isAntigravityAcpAgent(agent.id))
  const grokModels = pickMap(blob.modelsByAgentId, keepGrok)
  const grokConfig = pickMap(blob.configByAgentId, keepGrok)
  const antiModels = pickMap(blob.modelsByAgentId, (id) => isAntigravityAcpAgent(id))
  const antiConfig = pickMap(blob.configByAgentId, (id) => isAntigravityAcpAgent(id))
  const split: Partial<Record<AcpHarnessId, AcpResources>> = {}
  if (slotHasData(grokAgents, grokModels, grokConfig)) {
    const selected = blob.selectedAgentId && keepGrok(blob.selectedAgentId)
      ? blob.selectedAgentId
      : acpAgentIdForHarness('acp-grok')
    split['acp-grok'] = {
      agents: grokAgents,
      selectedAgentId: selected,
      detecting: blob.detecting,
      modelsByAgentId: grokModels,
      configByAgentId: grokConfig,
    }
  }
  if (slotHasData(antiAgents, antiModels, antiConfig)) {
    split['acp-antigravity'] = {
      agents: antiAgents,
      selectedAgentId: acpAgentIdForHarness('acp-antigravity'),
      detecting: blob.detecting,
      modelsByAgentId: antiModels,
      configByAgentId: antiConfig,
    }
  }
  return split
}

export function applySplitAcpResources<T extends AcpResourceSlots>(
  resources: T,
  blob: AcpResources | null | undefined,
): T {
  const split = splitLegacyAcpResources(blob)
  let next = resources
  if (split['acp-grok']) next = { ...next, 'acp-grok': split['acp-grok'] }
  if (split['acp-antigravity']) next = { ...next, 'acp-antigravity': split['acp-antigravity'] }
  return next
}

export function mapAcpResources<T extends AcpResourceSlots>(
  resources: T,
  agentId: string | null | undefined,
  updater: (current: AcpResources) => AcpResources,
): T {
  if (!agentId) return resources
  const harness = acpHarnessForAgent(agentId)
  const current = resources[harness]
  if (!current) return resources
  return { ...resources, [harness]: updater(current) }
}

export function combineAcpResources(
  grok: AcpResources | null | undefined,
  anti: AcpResources | null | undefined,
): AcpResources | null {
  if (!grok && !anti) return null
  return {
    agents: [...(grok?.agents ?? []), ...(anti?.agents ?? [])],
    selectedAgentId: grok?.selectedAgentId ?? anti?.selectedAgentId ?? null,
    detecting: Boolean(grok?.detecting || anti?.detecting),
    modelsByAgentId: { ...(anti?.modelsByAgentId ?? {}), ...(grok?.modelsByAgentId ?? {}) },
    configByAgentId: { ...(anti?.configByAgentId ?? {}), ...(grok?.configByAgentId ?? {}) },
  }
}
