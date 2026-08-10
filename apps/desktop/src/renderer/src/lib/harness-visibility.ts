/**
 * Which harnesses / ACP agents are available in pickers and the chat bar.
 *
 * P5: visibility is driven by the installation catalog (Settings → Harnesses).
 * - SDK / product catalog ids (`claude`, `codex`, `opencode`, `acp-grok`): enabled
 * - Non-Grok ACP agents: `enabledExperimentalAgents` (+ legacy master OR)
 * - If `listHarnesses` has not returned yet (catalog null), nothing is visible
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

/**
 * Whether a first-party catalog harness may appear in pickers / chat bar.
 * `catalog === null` means unknown (IPC not ready) — treat as not enabled so
 * we never flash a disabled harness (e.g. Claude Code) as a fake default.
 */
export function isCatalogHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: 'claude' | 'codex' | 'opencode' | 'acp-grok',
): boolean {
  if (catalog == null) return false
  return catalogEntryOn(catalog, id)
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
  if (isGrokAcpAgent(agentId)) {
    // Grok product harness uses catalog id acp-grok — callers should use
    // isCatalogHarnessEnabled('acp-grok') instead of this helper alone.
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
