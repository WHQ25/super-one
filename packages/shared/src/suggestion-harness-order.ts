import type {
  HarnessId,
  HarnessSessionRank,
  SuggestionHarnessPreference,
} from '@superone/shared/agent-types'
import {
  acpAgentIdForHarness,
  isAntigravityAcpAgent,
  isConcreteHarnessId,
  isGrokAcpAgent,
  isOpenCodeAcpAgent,
  resolveLegacyHarnessId,
} from '@superone/shared/acp-brand'

export interface SuggestionHarnessOption {
  key: string
  provider: HarnessId
  acpAgentId: string | null
  label: string
  sessionCount: number
}

export function suggestionHarnessKey(provider: HarnessId, _acpAgentId?: string | null): string {
  return provider
}

export function canonicalSuggestionHarnessKey(key: string): string | null {
  const trimmed = key.trim()
  if (!trimmed || trimmed === 'auto') return null
  if (isConcreteHarnessId(trimmed)) return trimmed
  if (trimmed === 'acp') return 'acp-grok'
  if (!trimmed.startsWith('acp:')) return null
  const agent = trimmed.slice(4).trim()
  if (!agent) return null
  if (isAntigravityAcpAgent(agent)) return 'acp-antigravity'
  if (isOpenCodeAcpAgent(agent)) return 'opencode'
  if (isGrokAcpAgent(agent)) return 'acp-grok'
  return null
}

export function suggestionPreferenceFromKey(key: string): SuggestionHarnessPreference | null {
  const canonical = canonicalSuggestionHarnessKey(key)
  if (!canonical || !isConcreteHarnessId(canonical)) return null
  if (canonical === 'acp-grok' || canonical === 'acp-antigravity') {
    return { provider: canonical, acpAgentId: acpAgentIdForHarness(canonical) }
  }
  return { provider: canonical, acpAgentId: null }
}

function preferenceKey(pref: SuggestionHarnessPreference | null | undefined): string | null {
  if (!pref) return null
  return resolveLegacyHarnessId(pref.provider, { acpAgentId: pref.acpAgentId })
}

function defaultRankIndex(option: Pick<SuggestionHarnessOption, 'provider'>): number {
  if (option.provider === 'claude') return 0
  if (option.provider === 'codex') return 1
  if (option.provider === 'acp-grok') return 2
  if (option.provider === 'acp-antigravity') return 3
  if (option.provider === 'opencode') return 4
  if (option.provider === 'cursor') return 5
  if (option.provider === 'dsh') return 6
  return 50
}

/**
 * Build ChatSuggestions harness order:
 * - Include claude/codex when flags say so (catalog enable; default true)
 * - Include each visible ACP agent as its own entry (caller filters experimental)
 * - Include opencode only when `includeOpenCode` (catalog enable)
 * - Include cursor only when `includeCursor` (catalog enable)
 * - Include DeepSeek only when `includeDeepseek` (catalog enable)
 * - When `harnessOrder` is non-empty: full manual order (index 0 = default, 1 = secondary, …);
 *   unknown keys among enabled options append after, sorted by usage then product default
 * - Else: manual default → secondary pins first, then parent-session count desc,
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
  /** When true, add Cursor as a suggestion harness. */
  includeCursor?: boolean
  /** When true, add DeepSeek as a suggestion harness. */
  includeDeepseek?: boolean
  /**
   * @deprecated Use `includeOpenCode`. Kept so older call sites compiling
   * against experimentalAgentsEnabled still typecheck during migration.
   */
  experimentalAgentsEnabled?: boolean
  /**
   * Full manual order (suggestion keys). When non-empty, overrides pin + usage ranking.
   */
  harnessOrder?: string[] | null
  /** null/undefined = Auto (no pin). Used only when harnessOrder is empty. */
  defaultHarness?: SuggestionHarnessPreference | null
  /** null/undefined = Auto (no pin). Ignored when equal to default. */
  secondaryHarness?: SuggestionHarnessPreference | null
}): SuggestionHarnessOption[] {
  const countByKey = new Map<string, number>()
  for (const rank of input.ranks) {
    const key = canonicalSuggestionHarnessKey(rank.key) ?? rank.key
    countByKey.set(key, (countByKey.get(key) ?? 0) + rank.sessionCount)
  }

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
    const provider = isAntigravityAcpAgent(agent.id)
      ? 'acp-antigravity'
      : isGrokAcpAgent(agent.id)
        ? 'acp-grok'
        : null
    if (!provider || options.some((option) => option.provider === provider)) continue
    options.push({
      key: provider,
      provider,
      acpAgentId: acpAgentIdForHarness(provider),
      label: agent.name,
      sessionCount: countByKey.get(provider) ?? 0,
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

  if (input.includeCursor) {
    options.push({
      key: 'cursor',
      provider: 'cursor',
      acpAgentId: null,
      label: 'Cursor',
      sessionCount: countByKey.get('cursor') ?? 0,
    })
  }

  if (input.includeDeepseek) {
    options.push({
      key: 'dsh',
      provider: 'dsh',
      acpAgentId: null,
      label: 'DeepSeek',
      sessionCount: countByKey.get('dsh') ?? 0,
    })
  }

  const byUsageThenDefault = (a: SuggestionHarnessOption, b: SuggestionHarnessOption): number => {
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
    const di = defaultRankIndex(a) - defaultRankIndex(b)
    if (di !== 0) return di
    return a.key.localeCompare(b.key)
  }

  const orderKeys = (input.harnessOrder ?? []).filter((k) => typeof k === 'string' && k.length > 0)
  if (orderKeys.length > 0) {
    const byKey = new Map(options.map((o) => [o.key, o] as const))
    const ordered: SuggestionHarnessOption[] = []
    const used = new Set<string>()
    for (const rawKey of orderKeys) {
      const key = canonicalSuggestionHarnessKey(rawKey) ?? rawKey
      const opt = byKey.get(key)
      if (!opt || used.has(key)) continue
      ordered.push(opt)
      used.add(key)
    }
    const rest = options.filter((o) => !used.has(o.key)).sort(byUsageThenDefault)
    return [...ordered, ...rest]
  }

  const defaultKey = preferenceKey(input.defaultHarness)
  const secondaryKey = preferenceKey(input.secondaryHarness)
  const effectiveSecondaryKey =
    secondaryKey && secondaryKey !== defaultKey ? secondaryKey : null

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
  const optionProvider = resolveLegacyHarnessId(option.provider, { acpAgentId: option.acpAgentId })
  const prefProvider = resolveLegacyHarnessId(pref.provider, { acpAgentId: pref.acpAgentId })
  return optionProvider != null && optionProvider === prefProvider
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

export interface AutoApplyHarnessDecision {
  /** Target to record as already auto-applied, even when no switch follows. */
  remember: SuggestionHarnessOption | null
  /** Harness to switch to, or null when the current selection already stands. */
  apply: SuggestionHarnessOption | null
}

/**
 * Decide whether an empty session should adopt the default (or top-ranked) harness.
 *
 * The auto-apply exists so a fresh session opens on the harness the user prefers. It
 * must never overrule a pick the user made by hand: `harnessUserChosen` is session
 * state precisely because the component rendering this surface is unmounted and
 * remounted (starting a realtime call does exactly that), and anything remembered in
 * the component would be forgotten at that moment.
 */
export function resolveAutoApplyHarness(input: {
  disableAutoApply: boolean
  harnessUserChosen: boolean
  hostSessionOwned?: boolean
  fixedHarness: SuggestionHarnessOption | null
  /** `undefined` while settings are still loading — decide nothing yet. */
  suggestionHarness: SuggestionHarnessPreference | null | undefined
  orderedHarnesses: SuggestionHarnessOption[]
  messageCount: number
  lastAppliedKey: string | null
  activeKey: string
}): AutoApplyHarnessDecision {
  const none: AutoApplyHarnessDecision = { remember: null, apply: null }
  if (input.disableAutoApply) return none
  if (input.hostSessionOwned) return none
  if (input.harnessUserChosen) return none
  if (!input.fixedHarness) return none
  if (input.suggestionHarness === undefined) return none
  if (input.messageCount > 0) return none

  const preference = input.suggestionHarness
  const target = preference == null
    ? input.fixedHarness
    : input.orderedHarnesses.find((option) => matchesPreference(option, preference)) ?? input.fixedHarness

  // Only a *changed* target re-applies, so switching to the secondary tab is not
  // snapped back to the default on the next render.
  if (input.lastAppliedKey === target.key) return none
  return { remember: target, apply: input.activeKey === target.key ? null : target }
}
