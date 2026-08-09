import type {
  HarnessId,
  HarnessSessionRank,
  SuggestionHarnessPreference,
} from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'

export interface SuggestionHarnessOption {
  key: string
  provider: HarnessId
  acpAgentId: string | null
  label: string
  sessionCount: number
}

export function suggestionHarnessKey(provider: HarnessId, acpAgentId?: string | null): string {
  if (provider === 'acp') {
    const agent = acpAgentId?.trim()
    return agent ? `acp:${agent}` : 'acp'
  }
  return provider
}

function defaultRankIndex(option: Pick<SuggestionHarnessOption, 'provider' | 'acpAgentId'>): number {
  if (option.provider === 'claude') return 0
  if (option.provider === 'codex') return 1
  if (option.provider === 'acp') {
    // Prefer Grok Build among ACP agents when counts tie / are zero.
    return isGrokAcpAgent(option.acpAgentId) ? 2 : 3
  }
  if (option.provider === 'opencode') return 4
  return 50
}

/**
 * Build ChatSuggestions harness order:
 * - Always include claude + codex
 * - Include each visible ACP agent as its own entry
 * - Include opencode only when experimental agents are enabled
 * - Sort by last-window sessionCount desc, then stable product default order
 */
export function orderSuggestionHarnesses(input: {
  ranks: HarnessSessionRank[]
  acpAgents: Array<{ id: string; name: string }>
  experimentalAgentsEnabled: boolean
}): SuggestionHarnessOption[] {
  const countByKey = new Map(input.ranks.map((r) => [r.key, r.sessionCount] as const))

  const options: SuggestionHarnessOption[] = [
    {
      key: 'claude',
      provider: 'claude',
      acpAgentId: null,
      label: 'Claude Code',
      sessionCount: countByKey.get('claude') ?? 0,
    },
    {
      key: 'codex',
      provider: 'codex',
      acpAgentId: null,
      label: 'Codex',
      sessionCount: countByKey.get('codex') ?? 0,
    },
  ]

  for (const agent of input.acpAgents) {
    const key = suggestionHarnessKey('acp', agent.id)
    options.push({
      key,
      provider: 'acp',
      acpAgentId: agent.id,
      label: agent.name,
      sessionCount: countByKey.get(key) ?? 0,
    })
  }

  if (input.experimentalAgentsEnabled) {
    options.push({
      key: 'opencode',
      provider: 'opencode',
      acpAgentId: null,
      label: 'OpenCode',
      sessionCount: countByKey.get('opencode') ?? 0,
    })
  }

  return options.sort((a, b) => {
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
    const di = defaultRankIndex(a) - defaultRankIndex(b)
    if (di !== 0) return di
    return a.key.localeCompare(b.key)
  })
}

function matchesPreference(
  option: SuggestionHarnessOption,
  pref: SuggestionHarnessPreference,
): boolean {
  if (option.provider !== pref.provider) return false
  if (option.provider !== 'acp') return true
  return option.acpAgentId === (pref.acpAgentId ?? null)
}

/**
 * Resolve which harness the dropdown slot should show:
 * 1. Currently active menu harness
 * 2. User's last menu pick (even after switching to the fixed slot)
 * 3. Rank #2 fallback
 */
export function resolveMenuTabOption(input: {
  menuHarnesses: SuggestionHarnessOption[]
  activeKey: string
  rememberedMenu: SuggestionHarnessPreference | null | undefined
}): SuggestionHarnessOption | null {
  const active = input.menuHarnesses.find((o) => o.key === input.activeKey)
  if (active) return active
  if (input.rememberedMenu != null) {
    const remembered = input.menuHarnesses.find((o) => matchesPreference(o, input.rememberedMenu!))
    if (remembered) return remembered
  }
  return input.menuHarnesses[0] ?? null
}
