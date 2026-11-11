/**
 * ACP is a protocol; brand identity is the underlying agent (Grok, OpenCode, …).
 * brandKey is used for icons / labels — e.g. `acp-grok`.
 */

import type { HarnessId } from './harness-id'

const CONCRETE_HARNESS_IDS = ['claude', 'codex', 'opencode', 'cursor', 'acp-grok', 'acp-antigravity', 'dsh'] as const

export function isConcreteHarnessId(value: string | null | undefined): value is HarnessId {
  return !!value && (CONCRETE_HARNESS_IDS as readonly string[]).includes(value)
}

export function isAcpProtocolHarness(id: string | null | undefined): id is 'acp-grok' | 'acp-antigravity' {
  return id === 'acp-grok' || id === 'acp-antigravity'
}

export function acpAgentIdForHarness(id: 'acp-grok' | 'acp-antigravity'): 'grok-build' | 'antigravity' {
  return id === 'acp-antigravity' ? 'antigravity' : 'grok-build'
}

export interface LegacyHarnessHint {
  acpAgentId?: string | null
  providerId?: string | null
}

export function resolveLegacyHarnessId(
  raw: string | null | undefined,
  hint?: LegacyHarnessHint,
): HarnessId | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  if (isConcreteHarnessId(value)) return value
  if (value !== 'acp') return null
  const providerId = hint?.providerId?.trim() || null
  const agent = hint?.acpAgentId?.trim() || null
  if (providerId === 'acp-antigravity' || isAntigravityAcpAgent(agent)) return 'acp-antigravity'
  if (isOpenCodeAcpAgent(agent)) return 'opencode'
  return 'acp-grok'
}

export function isGrokAcpAgent(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  const id = agentId.toLowerCase()
  return id.includes('grok')
}

export function isAntigravityAcpAgent(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  return agentId.toLowerCase().includes('antigravity')
}

export function isOpenCodeAcpAgent(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  return agentId.toLowerCase().includes('opencode')
}

/**
 * UI brand key. Session identity and the chip mark are different: an unknown
 * legacy `acp` row launches as Grok, but a custom ACP agent keeps its own mark
 * (`acp-<agent>`), and a bare `acp` stays the generic ACP mark.
 */
export function resolveHarnessBrandKey(
  harnessId: string | null | undefined,
  acpAgentId?: string | null,
): string {
  if (!harnessId) return 'claude'
  if (harnessId !== 'acp') return harnessId
  if (isGrokAcpAgent(acpAgentId)) return 'acp-grok'
  if (isAntigravityAcpAgent(acpAgentId)) return 'acp-antigravity'
  if (isOpenCodeAcpAgent(acpAgentId)) return 'acp-opencode'
  if (acpAgentId?.trim()) {
    const short = acpAgentId.trim().toLowerCase().replace(/-build$/, '').replace(/[^a-z0-9]+/g, '-')
    return short ? `acp-${short}` : 'acp'
  }
  return 'acp'
}

/** Short human name for collab titles (`Name - Role`). */
export function acpAgentDisplayName(
  agentId: string | null | undefined,
  catalogName?: string | null,
): string {
  if (catalogName?.trim()) {
    // "Grok Build" → "Grok"
    return catalogName.trim().replace(/\s+Build$/i, '')
  }
  if (isGrokAcpAgent(agentId)) return 'Grok'
  if (isAntigravityAcpAgent(agentId)) return 'Antigravity'
  if (isOpenCodeAcpAgent(agentId)) return 'OpenCode'
  if (agentId?.trim()) {
    return agentId
      .trim()
      .replace(/-build$/i, '')
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
  return 'ACP'
}
