/**
 * Which harnesses / ACP agents are available in pickers and the chat bar.
 *
 * P5: visibility is driven by the installation catalog (Settings → Harnesses).
 * - SDK / product catalog ids (`claude`, `codex`, `opencode`, `cursor`, `acp-grok`): enabled
 * - Non-Grok ACP agents: `enabledExperimentalAgents` (+ legacy master OR)
 * - If `listHarnesses` has not returned yet (catalog null), nothing is visible
 */

import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/agent-types'
import { NODE_HARNESS_DEFINITIONS } from '@superone/shared/environment/harness-installation'
import { isExperimentalAgentProvider } from '@/stores/chat-store/helpers/provider-routing'

export interface HarnessCatalogStatus {
  id: string
  enabled: boolean
  state: string
}

export function catalogEntryOn(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: string,
): boolean {
  const row = catalog?.find((r) => r.id === id)
  return Boolean(row?.enabled && row.state !== 'disabled')
}

export function isCatalogHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok' | 'acp-antigravity' | 'dsh',
): boolean {
  if (catalog == null) return false
  return catalogEntryOn(catalog, id)
}

export function isCatalogHarnessDisabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: string,
): boolean {
  if (catalog == null) return false
  const row = catalog.find((r) => r.id === id)
  return Boolean(row && !row.enabled)
}

export function catalogFromHarnessIds(harnessIds: readonly string[]): HarnessCatalogStatus[] {
  return NODE_HARNESS_DEFINITIONS.map((def) => {
    const runnable = harnessIds.includes(def.sessionHarnessId)
    return { id: def.id, enabled: runnable, state: runnable ? 'ready' : 'disabled' }
  })
}

export function catalogIdForSessionProvider(
  provider: string,
  acpAgentId?: string | null,
): string | null {
  if (provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'cursor' || provider === 'dsh') {
    return provider
  }
  if (provider === 'acp') {
    if (!acpAgentId || isGrokAcpAgent(acpAgentId)) return 'acp-grok'
    if (isAntigravityAcpAgent(acpAgentId)) return 'acp-antigravity'
    return null
  }
  return null
}

export function isExperimentalAcpAgentEnabled(
  agentId: string,
  opts: {
    enabledExperimentalAgents: string[]
    legacyExperimentalAgentsEnabled?: boolean
  },
): boolean {
  if (isGrokAcpAgent(agentId) || isAntigravityAcpAgent(agentId)) {
    return true
  }
  if (opts.legacyExperimentalAgentsEnabled) return true
  return opts.enabledExperimentalAgents.includes(agentId)
}

export function isOpenCodeEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  legacyExperimentalAgentsEnabled?: boolean,
): boolean {
  if (legacyExperimentalAgentsEnabled) return true
  return isCatalogHarnessEnabled(catalog, 'opencode')
}

export function isGrokHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'acp-grok')
}

export function isAntigravityHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'acp-antigravity')
}

export function isClaudeHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'claude')
}

export function isCodexHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'codex')
}

export function isCursorHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'cursor')
}

export function isDeepseekHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'dsh')
}

export function isPickerHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  provider: HarnessId,
  agentId: string | null | undefined,
  opts: { enabledExperimentalAgents: string[]; legacyExperimentalAgentsEnabled?: boolean },
): boolean {
  const catalogId = catalogIdForSessionProvider(provider, agentId)
  if (!catalogId) return !!agentId && isExperimentalAcpAgentEnabled(agentId, opts)
  if (!agentId && catalogId === 'acp-grok') {
    if (catalog == null) return true
    return catalogEntryOn(catalog, catalogId)
  }
  if (catalog != null && catalogEntryOn(catalog, catalogId)) return true
  return !!opts.legacyExperimentalAgentsEnabled && isExperimentalAgentProvider(provider, agentId)
}
