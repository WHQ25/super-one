/**
 * ACP is a protocol; brand identity is the underlying agent (Grok, OpenCode, …).
 * brandKey is used for icons / labels — e.g. `acp-grok`.
 */

export function isGrokAcpAgent(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  const id = agentId.toLowerCase()
  return id.includes('grok')
}

export function isOpenCodeAcpAgent(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  return agentId.toLowerCase().includes('opencode')
}

/** UI brand key: `acp-grok`, `acp-opencode`, or `acp` / harness id for non-ACP. */
export function resolveHarnessBrandKey(
  harnessId: string | null | undefined,
  acpAgentId?: string | null,
): string {
  if (!harnessId) return 'claude'
  if (harnessId !== 'acp') return harnessId
  if (isGrokAcpAgent(acpAgentId)) return 'acp-grok'
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
