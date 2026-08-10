/**
 * Which harnesses / ACP agents are available in pickers and the chat bar.
 *
 * Replaces the global `experimentalAgentsEnabled` master switch with:
 * - catalog enable for opencode / acp-grok
 * - `enabledExperimentalAgents` for individual non-Grok ACP agents
 * - legacy master switch still OR'd in so existing installs keep working
 */

import { isGrokAcpAgent } from '@superone/shared/acp-brand'

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

/** Whether a non-Grok ACP agent id may appear in pickers / suggestions. */
export function isExperimentalAcpAgentEnabled(
  agentId: string,
  opts: {
    enabledExperimentalAgents: string[]
    /** Legacy master switch — still honored until cleared. */
    legacyExperimentalAgentsEnabled?: boolean
  },
): boolean {
  if (isGrokAcpAgent(agentId)) return true
  if (opts.legacyExperimentalAgentsEnabled) return true
  return opts.enabledExperimentalAgents.includes(agentId)
}

export function isOpenCodeEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  legacyExperimentalAgentsEnabled?: boolean,
): boolean {
  if (legacyExperimentalAgentsEnabled) return true
  return catalogEntryOn(catalog, 'opencode')
}

export function isGrokHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  // Grok is a product harness: if the catalog has never been used (empty /
  // missing row), keep it visible so existing sessions don't vanish.
  if (!catalog || catalog.length === 0) return true
  const row = catalog.find((r) => r.id === 'acp-grok')
  if (!row) return true
  return row.enabled && row.state !== 'disabled'
}
