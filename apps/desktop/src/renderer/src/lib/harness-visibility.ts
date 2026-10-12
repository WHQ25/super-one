/**
 * Which harnesses / ACP agents are available in pickers and the chat bar.
 *
 * P5: visibility is driven by the installation catalog (Settings → Harnesses).
 * - SDK / product catalog ids (`claude`, `codex`, `opencode`, `cursor`, `acp-grok`): enabled
 * - Non-Grok ACP agents: `enabledExperimentalAgents` (+ legacy master OR)
 * - If `listHarnesses` has not returned yet (catalog null), nothing is visible
 */

import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/agent-types'
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

/**
 * Whether a first-party catalog harness may appear in pickers / chat bar.
 * `catalog === null` means unknown (IPC not ready) — treat as not enabled so
 * we never flash a disabled harness (e.g. Claude Code) as a fake default.
 */
export function isCatalogHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok' | 'dsh',
): boolean {
  if (catalog == null) return false
  return catalogEntryOn(catalog, id)
}

/**
 * True only when the catalog is known *and* the row is explicitly disabled.
 * Unknown catalog (`null`) is not disabled — treating it as disabled would
 * flash a read-only session banner on every launch before listHarnesses returns.
 */
export function isCatalogHarnessDisabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  id: string,
): boolean {
  if (catalog == null) return false
  const row = catalog.find((r) => r.id === id)
  return Boolean(row && !row.enabled)
}

/**
 * Map a session's active provider to the Settings → Harnesses catalog id.
 * Returns null for providers that are not gated by the catalog (e.g. experimental ACP).
 */
export function catalogIdForSessionProvider(
  provider: string,
  acpAgentId?: string | null,
): string | null {
  if (provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'cursor' || provider === 'dsh') {
    return provider
  }
  if (provider === 'acp') {
    if (!acpAgentId || isGrokAcpAgent(acpAgentId)) return 'acp-grok'
    return null
  }
  return null
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

/** Whether the Cursor catalog harness may appear in pickers / chat bar. */
export function isCursorHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'cursor')
}

/** Whether the DeepSeek catalog harness may appear in pickers / chat bar. */
export function isDeepseekHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
): boolean {
  return isCatalogHarnessEnabled(catalog, 'dsh')
}

/**
 * Whether a harness (and, for ACP, an agent) may be picked: its catalog row,
 * else the experimental-agent switches. One rule for every harness picker.
 * ACP without an agent yet stays pickable while its agent resolves.
 */
export function isPickerHarnessEnabled(
  catalog: HarnessCatalogStatus[] | null | undefined,
  provider: HarnessId,
  agentId: string | null | undefined,
  opts: { enabledExperimentalAgents: string[]; legacyExperimentalAgentsEnabled?: boolean },
): boolean {
  const catalogId = catalogIdForSessionProvider(provider, agentId)
  // A non-Grok ACP agent is opted into one by one.
  if (!catalogId) return !!agentId && isExperimentalAcpAgentEnabled(agentId, opts)
  if (!agentId && catalogId === 'acp-grok') return true
  if (catalog != null && catalogEntryOn(catalog, catalogId)) return true
  // The legacy experimental switch still enables OpenCode.
  return !!opts.legacyExperimentalAgentsEnabled && isExperimentalAgentProvider(provider, agentId)
}
