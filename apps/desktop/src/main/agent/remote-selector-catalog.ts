import { codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'
import type {
  ClaudeAccount,
  DeepseekPresetRoster,
  HarnessId,
  OpenCodeResources,
  RemoteAgentOption,
  RemoteModeOption,
  RemoteProviderOption,
} from '@superone/shared/agent-types'
import { claudeAccountProviderId } from '@superone/shared/agent-types'

/**
 * The catalogs the desktop model selector renders next to model + effort, projected
 * for Remote Control clients. Each harness wrapper on the desktop owns one of these;
 * mobile has a single picker, so the host does the per-harness thinking here.
 */

/** Unselected means OpenCode's configured default, not a forced Build agent. */
export function openCodeAgentCatalog(resources: OpenCodeResources | null | undefined): {
  agents: RemoteAgentOption[]
  selectedAgentId: string | null
} {
  const agents = (resources?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
  }))
  return { agents, selectedAgentId: null }
}

/** DeepSeek presets are a mode pick, and a session that has produced output cannot switch. */
export function deepseekModeCatalog(roster: DeepseekPresetRoster | null | undefined): {
  modes: RemoteModeOption[]
  selectedModeId: string | null
  modesLocked: boolean
} {
  const presets = roster?.presets ?? []
  return {
    modes: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      ...(preset.description ? { description: preset.description } : {}),
      ...(preset.broken ? { disabled: true } : {}),
    })),
    selectedModeId: roster?.current ?? presets[0]?.id ?? null,
    modesLocked: presets.length > 0 && roster?.switchable === false,
  }
}

export interface ProviderCatalogSource {
  /** Masked credentials from the store, in sort order. */
  credentials: Array<{ id: string; name?: string; platformId: string }>
  /**
   * Whether this credential can actually serve the harness's chat consumer, and
   * the mapping it would run under — the client cannot resolve that itself.
   */
  servesHarness: (credentialId: string) => Pick<RemoteProviderOption, 'brand' | 'modelEnv'> | null
  /** Platform name + favicon for a credential row, as the desktop picker draws it. */
  platformDisplay: (platformId: string) => { name: string; icon?: string }
  /** Logged-in Claude accounts; only surfaced once there is more than one. */
  claudeAccounts?: ClaudeAccount[]
  codexAccounts?: CodexAccount[]
  /** Credential id the session currently resolves to, or null for the host default. */
  selectedProviderId?: string | null
}

/** One row per signed-in subscription account the host manages; empty when only the harness's own login exists. */
export function subscriptionAccountProviders(
  harness: 'claude' | 'codex',
  source: Pick<ProviderCatalogSource, 'claudeAccounts' | 'codexAccounts'>,
): Array<RemoteProviderOption & { id: string }> {
  if (harness === 'codex') {
    return (source.codexAccounts ?? []).filter((a) => a.signedIn).map((account) => ({
      id: codexAccountProviderId(account.id),
      name: 'ChatGPT',
      brand: 'openai',
      keyName: [account.email, account.planType].filter(Boolean).join(' · '),
    }))
  }
  const accounts = source.claudeAccounts ?? []
  return accounts.map((account) => ({
    id: claudeAccountProviderId(account.credentialDir)!,
    name: 'Claude',
    brand: 'claude',
    ...(claudeAccountKeyName(account, accounts) ? { keyName: claudeAccountKeyName(account, accounts)! } : {}),
  }))
}

/**
 * Mirrors `useSelectorProviders`: the host default first, then every credential
 * that can serve this harness. Claude's default row expands into one row per
 * logged-in account only when there is a second account to tell apart — a single
 * account looks exactly like it did before multi-account existed.
 */
export function harnessProviderCatalog(
  harness: HarnessId,
  source: ProviderCatalogSource,
): { providers: RemoteProviderOption[]; selectedProviderId: string | null } {
  if (harness !== 'claude' && harness !== 'codex') {
    return { providers: [], selectedProviderId: null }
  }
  const accounts = subscriptionAccountProviders(harness, source)
  const providers: RemoteProviderOption[] = accounts.length > 0
    ? accounts
    : [{ id: null, name: harness === 'codex' ? 'ChatGPT' : 'Claude', brand: harness === 'codex' ? 'openai' : 'claude' }]

  for (const credential of source.credentials) {
    const served = source.servesHarness(credential.id)
    if (!served) continue
    // The row is a brand lockup plus a key badge, so the name stays the platform's
    // own. Folding the key into it too spelled the key twice on every row.
    const platform = source.platformDisplay(credential.platformId)
    providers.push({
      id: credential.id,
      name: platform.name,
      brand: served.brand ?? null,
      ...(platform.icon ? { icon: platform.icon } : {}),
      ...(credential.name ? { keyName: credential.name } : {}),
      ...(served.modelEnv && Object.keys(served.modelEnv).length > 0 ? { modelEnv: served.modelEnv } : {}),
    })
  }
  return { providers, selectedProviderId: source.selectedProviderId ?? null }
}

/**
 * Plans are org-scoped, so the same email can name two accounts with two usage
 * pools. The org is appended only when it is needed to tell rows apart.
 */
export function claudeAccountKeyName(
  account: ClaudeAccount,
  all: readonly ClaudeAccount[],
): string | undefined {
  const email = account.email?.trim()
  if (!email) return account.orgName?.trim() || undefined
  if (all.filter((other) => other.email?.trim() === email).length < 2) return email
  const org = account.orgName?.trim()
  return org ? `${email} · ${org}` : email
}
