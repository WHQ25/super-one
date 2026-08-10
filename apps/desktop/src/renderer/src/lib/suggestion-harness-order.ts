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

function preferenceKey(pref: SuggestionHarnessPreference | null | undefined): string | null {
  if (!pref) return null
  return suggestionHarnessKey(pref.provider, pref.acpAgentId)
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
 * - Include claude/codex when flags say so (catalog enable; default true)
 * - Include each visible ACP agent as its own entry (caller filters experimental)
 * - Include opencode only when `includeOpenCode` (catalog enable)
 * - Manual default → secondary pins first, then parent-session count desc,
 *   then stable product default order
 */
export function orderSuggestionHarnesses(input: {
  ranks: HarnessSessionRank[]
  acpAgents: Array<{ id: string; name: string }>
  /** When false, omit Claude Code. Default true. */
  includeClaude?: boolean
  /** When false, omit Codex. Default true. */
  includeCodex?: boolean
  /** When true, add OpenCode as a suggestion harness. */
  includeOpenCode?: boolean
  /**
   * @deprecated Use `includeOpenCode`. Kept so older call sites compiling
   * against experimentalAgentsEnabled still typecheck during migration.
   */
  experimentalAgentsEnabled?: boolean
  /** null/undefined = Auto (no pin). */
  defaultHarness?: SuggestionHarnessPreference | null
  /** null/undefined = Auto (no pin). Ignored when equal to default. */
  secondaryHarness?: SuggestionHarnessPreference | null
}): SuggestionHarnessOption[] {
  const countByKey = new Map(input.ranks.map((r) => [r.key, r.sessionCount] as const))

  const options: SuggestionHarnessOption[] = []

  if (input.includeClaude !== false) {
    options.push({
      key: 'claude',
      provider: 'claude',
      acpAgentId: null,
      label: 'Claude Code',
      sessionCount: countByKey.get('claude') ?? 0,
    })
  }
  if (input.includeCodex !== false) {
    options.push({
      key: 'codex',
      provider: 'codex',
      acpAgentId: null,
      label: 'Codex',
      sessionCount: countByKey.get('codex') ?? 0,
    })
  }

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

  const includeOpenCode = input.includeOpenCode ?? input.experimentalAgentsEnabled ?? false
  if (includeOpenCode) {
    options.push({
      key: 'opencode',
      provider: 'opencode',
      acpAgentId: null,
      label: 'OpenCode',
      sessionCount: countByKey.get('opencode') ?? 0,
    })
  }

  const defaultKey = preferenceKey(input.defaultHarness)
  const secondaryKey = preferenceKey(input.secondaryHarness)
  const effectiveSecondaryKey =
    secondaryKey && secondaryKey !== defaultKey ? secondaryKey : null

  const byUsageThenDefault = (a: SuggestionHarnessOption, b: SuggestionHarnessOption): number => {
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
    const di = defaultRankIndex(a) - defaultRankIndex(b)
    if (di !== 0) return di
    return a.key.localeCompare(b.key)
  }

  const defaultOpt = defaultKey ? options.find((o) => o.key === defaultKey) ?? null : null
  const secondaryOpt = effectiveSecondaryKey
    ? options.find((o) => o.key === effectiveSecondaryKey) ?? null
    : null
  const rest = options
    .filter((o) => o !== defaultOpt && o !== secondaryOpt)
    .sort(byUsageThenDefault)

  // Manual default → #1; manual secondary → #2 (after auto top when default is Auto).
  if (defaultOpt && secondaryOpt) return [defaultOpt, secondaryOpt, ...rest]
  if (defaultOpt) return [defaultOpt, ...rest]
  if (secondaryOpt) {
    const [autoTop, ...tail] = rest
    return autoTop ? [autoTop, secondaryOpt, ...tail] : [secondaryOpt]
  }
  return rest
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
 * 2. Rank #2 when secondary is pinned via settings (skip remembered override)
 * 3. User's last menu pick (only when secondary is Auto)
 * 4. Rank #2 fallback
 */
export function resolveMenuTabOption(input: {
  menuHarnesses: SuggestionHarnessOption[]
  activeKey: string
  rememberedMenu: SuggestionHarnessPreference | null | undefined
  /** True when secondary harness is manually set — honor ordered #2 over remembered. */
  secondaryPinned?: boolean
}): SuggestionHarnessOption | null {
  const active = input.menuHarnesses.find((o) => o.key === input.activeKey)
  if (active) return active
  if (!input.secondaryPinned && input.rememberedMenu != null) {
    const remembered = input.menuHarnesses.find((o) => matchesPreference(o, input.rememberedMenu!))
    if (remembered) return remembered
  }
  return input.menuHarnesses[0] ?? null
}
