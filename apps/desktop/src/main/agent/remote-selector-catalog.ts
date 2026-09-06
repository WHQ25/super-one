import type {
  ClaudeAccount,
  DeepseekPresetRoster,
  HarnessId,
  ModelOption,
  OpenCodeResources,
  RemoteAgentOption,
  RemoteEffortOption,
  RemoteModeOption,
  RemoteProviderOption,
} from '@superone/shared/agent-types'
import { claudeAccountProviderId } from '@superone/shared/agent-types'
import { formatEffortOptionLabel, sortEffortsAscending } from '@superone/shared/effort-labels'

/**
 * The catalogs the desktop model selector renders next to model + effort, projected
 * for Remote Control clients. Each harness wrapper on the desktop owns one of these;
 * mobile has a single picker, so the host does the per-harness thinking here.
 */

export interface AcpModeSource {
  modes: ModelOption[]
  /** `null` means the agent ships Grok-style extraModes, which ARE reasoning effort. */
  modeConfigId: string | null
  selectedModeId: string | null
}

export interface AcpModeProjection {
  efforts: RemoteEffortOption[]
  modes: RemoteModeOption[]
  selectedModeId: string | null
}

/**
 * Split an ACP mode catalog into effort and session modes the same way
 * `AcpModelSelector` does. Sending real session modes as `efforts` used to make
 * mobile draw a slider for `ask`/`code`, which the backend then dropped, because
 * only `low…max` survive `asGrokReasoningEffort`.
 */
export function acpModeCatalog(source: AcpModeSource | null): AcpModeProjection {
  const modes = source?.modes ?? []
  if (modes.length === 0) return { efforts: [], modes: [], selectedModeId: null }

  if (source!.modeConfigId == null) {
    const efforts = sortEffortsAscending(modes.map((mode) => ({
      value: mode.id,
      label: formatEffortOptionLabel(mode.name || mode.id),
      ...(mode.description ? { description: mode.description } : {}),
    })))
    return { efforts, modes: [], selectedModeId: null }
  }

  return {
    efforts: [],
    modes: modes.map((mode) => ({
      id: mode.id,
      name: mode.name || mode.id,
      ...(mode.description ? { description: mode.description } : {}),
    })),
    selectedModeId: source!.selectedModeId ?? modes[0]?.id ?? null,
  }
}

/** OpenCode primary agents; `build` is the default the desktop store also picks. */
export function openCodeAgentCatalog(resources: OpenCodeResources | null | undefined): {
  agents: RemoteAgentOption[]
  selectedAgentId: string | null
} {
  const agents = (resources?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
  }))
  const selectedAgentId = agents.find((agent) => agent.id === 'build')?.id ?? agents[0]?.id ?? null
  return { agents, selectedAgentId }
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
  /** Whether this credential can actually serve the harness's chat consumer. */
  servesHarness: (credentialId: string) => { brand?: string | null } | null
  platformName: (platformId: string) => string
  /** Logged-in Claude accounts; only surfaced once there is more than one. */
  claudeAccounts?: ClaudeAccount[]
  /** Credential id the session currently resolves to, or null for the host default. */
  selectedProviderId?: string | null
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
  const defaultName = harness === 'codex' ? 'ChatGPT' : 'Claude'
  const accounts = harness === 'claude' ? source.claudeAccounts ?? [] : []
  const providers: RemoteProviderOption[] = accounts.length > 1
    ? accounts.map((account) => ({
        id: claudeAccountProviderId(account.credentialDir),
        name: defaultName,
        brand: 'claude',
        ...(claudeAccountKeyName(account, accounts) ? { keyName: claudeAccountKeyName(account, accounts)! } : {}),
      }))
    : [{ id: null, name: defaultName, brand: harness === 'codex' ? 'openai' : 'claude' }]

  for (const credential of source.credentials) {
    const served = source.servesHarness(credential.id)
    if (!served) continue
    const base = source.platformName(credential.platformId)
    providers.push({
      id: credential.id,
      name: credential.name && credential.name !== base ? `${base} · ${credential.name}` : base,
      brand: served.brand ?? null,
      ...(credential.name ? { keyName: credential.name } : {}),
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
