/**
 * One subscription meter per session, whichever harness bills it.
 *
 * The desktop gauge picks its data source in the renderer (`UsageStatusIcon`);
 * a phone cannot, so the same four-way choice — Claude OAuth, third-party
 * Claude gateway, Codex ChatGPT, Grok over ACP — lives here and lands on the
 * shared `RemoteUsage` shape. Every source keeps its own throttle / cache, so
 * calling this on each turn end costs no extra upstream requests.
 */

import type {
  ClaudeAccount,
  ClaudeRateLimits,
  CodexAccountStatus,
  CodexAccountUsage,
  CodexRateLimits,
  HarnessId,
  ProviderRateLimits,
  RemoteUsage,
} from '@superone/shared/agent-types'
import { claudeAccountCredentialDir } from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'

export interface HarnessUsageRequest {
  provider: HarnessId
  projectPath: string
  sessionId?: string | null
  apiProviderId?: string | null
  acpAgentId?: string | null
  force?: boolean
}

export interface HarnessUsageDeps {
  /** `claude auth status` `apiProvider` of the default login — `'firstParty'` means an OAuth subscription. */
  claudeApiProvider: () => string | null | undefined
  claudeRateLimits: (force: boolean, credentialDir: string | null) => Promise<ClaudeRateLimits | null>
  claudeAccounts: () => Promise<ClaudeAccount[]>
  providerRateLimits: (apiProviderId: string, force: boolean) => Promise<ProviderRateLimits | null>
  codexRateLimits: (projectPath: string, apiProviderId: string | null) => Promise<CodexRateLimits | null>
  codexAccount: (projectPath: string, apiProviderId: string | null) => Promise<CodexAccountStatus | null>
  /** Lifetime stats plus the thread estimate for the session named in the request, when it has one. */
  codexAccountUsage: (projectPath: string, apiProviderId: string | null, sessionId: string | null) => Promise<CodexAccountUsage | null>
  acpRateLimits: (agentId: string, request: HarnessUsageRequest, force: boolean) => Promise<ProviderRateLimits | null>
}

/** Codex names a window by duration only; render it the way the desktop gauge does. */
export function codexWindowLabel(minutes: number | null): string {
  if (!minutes || minutes <= 0) return 'Usage'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function fromCodex(limits: CodexRateLimits, account: CodexAccountStatus | null, codexAccount: CodexAccountUsage | null): RemoteUsage | null {
  const windows = [limits.primary, limits.secondary].flatMap((window) => window
    ? [{ label: codexWindowLabel(window.windowDurationMins), usedPercent: window.usedPercent, resetsAt: window.resetsAt }]
    : [])
  if (windows.length === 0) return null
  return {
    kind: 'codex',
    title: 'Codex',
    account: account?.signedIn ? account.email ?? null : null,
    planType: limits.planType,
    windows,
    extraUsage: null,
    resetCredits: limits.resetCredits,
    ...(limits.resetCreditList ? { resetCreditList: limits.resetCreditList } : {}),
    codexAccount,
    fetchedAt: Date.now(),
  }
}

export async function readHarnessUsage(request: HarnessUsageRequest, deps: HarnessUsageDeps): Promise<RemoteUsage | null> {
  const { provider, projectPath } = request
  const apiProviderId = request.apiProviderId ?? null
  const force = request.force ?? false

  if (provider === 'codex') {
    const limits = await deps.codexRateLimits(projectPath, apiProviderId)
    if (!limits) return null
    // Only the ChatGPT sign-in owns the meter; a third-party key bills elsewhere.
    const [account, codexAccount] = await Promise.all([
      !apiProviderId || isCodexAccountProvider(apiProviderId)
        ? deps.codexAccount(projectPath, apiProviderId).catch(() => null)
        : null,
      deps.codexAccountUsage(projectPath, apiProviderId, request.sessionId ?? null).catch(() => null),
    ])
    return fromCodex(limits, account, codexAccount)
  }

  if (provider === 'claude') {
    // A non-default Claude account carries an apiProviderId too, so "has an id" does not
    // mean "third-party gateway": the account prefix keeps those on the OAuth meter.
    const credentialDir = claudeAccountCredentialDir(apiProviderId)
    if (apiProviderId && !credentialDir) {
      const limits = await deps.providerRateLimits(apiProviderId, force)
      if (!limits || limits.windows.length === 0) return null
      return { ...limits, kind: 'provider', account: null }
    }
    if (deps.claudeApiProvider() !== 'firstParty') return null
    const limits = await deps.claudeRateLimits(force, credentialDir)
    if (!limits || limits.windows.length === 0) return null
    const accounts = await deps.claudeAccounts().catch(() => [] as ClaudeAccount[])
    const account = accounts.find((entry) => entry.credentialDir === credentialDir)?.email ?? null
    return { ...limits, kind: 'claude', title: 'Claude', account }
  }

  // Grok is the only ACP agent with a billing surface; asking the others is a
  // round-trip to `method not found`.
  if (provider === 'acp' && request.acpAgentId && isGrokAcpAgent(request.acpAgentId)) {
    const limits = await deps.acpRateLimits(request.acpAgentId, request, force)
    if (!limits || limits.windows.length === 0) return null
    return { ...limits, kind: 'acp', account: null }
  }

  return null
}
