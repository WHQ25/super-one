import { useResolvedProviderId } from './chat/model-selector/useSelectorProviders'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLatestCodexThreadId, useActiveSession, useChatStore } from '@/stores/chat'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { claudeLimitsFromSubscription, claudeSubscriptionFromReport, unavailableNodeLimits } from '@/harness-ui/claude/remote-subscription-usage'
import { claudeAccountCredentialDir, isClaudeAccountProvider } from '@superone/shared/agent-types'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { ProviderLabel } from './ProviderLabel'
import { ExtraUsageBar, formatWindowLabel, GroupedWindowBars, ResetGrantsRow, WindowBar as WindowRow } from './provider-usage'
import type { UsageWindow } from '@superone/shared/subscription-usage'
import { useSubscriptionAlert } from './use-subscription-alert'
import { useCodexUsage } from './use-codex-usage'
import {
  FORCE_REFRESH_ON_OPEN_STALE_MS,
  RateLimitTipHost,
  remainingPercent,
  useRateLimitTip,
  type GaugeHighlight,
  type RateLimitTipInfo,
} from './usage-status/rate-limit-tip'
import {
  AccountUsageSection,
  claudeHubKey,
  codexHubKey,
  CreditBalanceRow,
  ResetCreditsRow,
  UNTRACKED_PROVIDER_BRAND,
} from './usage-status/usage-hub-shared'
import { RateLimitGauge } from './usage-status/rate-limit-gauge'
import { useRefetchOnTurnEnd, useVersionedProviderLimits } from './usage-status/use-versioned-provider-limits'

const ACP_BILLING_RETRY_MS = [2_000, 6_000] as const

function CodexRateLimitIcon({ projectPath, apiProviderId, threadId, status, tip: liveTip }: { projectPath: string; apiProviderId: string | null; threadId: string | null; status: string; tip: RateLimitTipInfo | null }) {
  const { t } = useTranslation()
  const { limits, usage, loaded, refreshing, fetchLimits, refresh } = useCodexUsage(projectPath, apiProviderId, threadId)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const windows: UsageWindow[] = [limits?.primary, limits?.secondary].flatMap((w) => w ? [{ ...w, label: formatWindowLabel(w.windowDurationMins, t) }] : [])
  const tip = useSubscriptionAlert(limits?.quotaKey ?? `codex:${projectPath}:${apiProviderId ?? 'default'}`, windows, liveTip, loaded)
  const highlight: GaugeHighlight = tip ? (tip.severity >= 2 ? 'error' : 'warning') : null

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) fetchLimits()
  }, [limits?.fetchedAt, fetchLimits])

  // Only for the ChatGPT sign-in. With an apiProviderId the turns bill a third-party key, and
  // naming the OAuth account would point at a subscription this session never touches.
  useEffect(() => {
    setAccountEmail(null)
    if (apiProviderId && !isCodexAccountProvider(apiProviderId)) return
    let cancelled = false
    window.app.codexGetAccountStatus(projectPath, apiProviderId)
      .then((account) => { if (!cancelled) setAccountEmail(account?.signedIn ? (account.email ?? null) : null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectPath, apiProviderId])

  useRefetchOnTurnEnd(status, fetchLimits)

  const badgeWindow = limits?.primary ?? limits?.secondary
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null
  const hasUsage = Boolean(limits && (limits.primary || limits.secondary))
  const activeAccountKey = !apiProviderId || isCodexAccountProvider(apiProviderId)
    ? codexHubKey(apiProviderId)
    : 'session:current'

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge
        title={<ProviderLabel brandKey="openai" size={14} />}
        label={t('usageGauge.codexTitle')}
        subtitle={accountEmail}
        planType={limits?.planType ?? null}
        badgeRemaining={badgeRemaining}
        hasUsage={hasUsage}
        activeAccountKey={activeAccountKey}
        sessionWindows={windows}
        onOpen={refreshIfStale}
        onRefresh={hasUsage ? refresh : undefined}
        refreshing={refreshing}
        fetchedAt={limits?.fetchedAt ?? null}
        highlight={highlight}
      >
        {limits?.primary && (
          <WindowRow {...limits.primary} label={formatWindowLabel(limits.primary.windowDurationMins, t)} />
        )}
        {limits?.secondary && (
          <WindowRow {...limits.secondary} label={formatWindowLabel(limits.secondary.windowDurationMins, t)} />
        )}
        {limits?.resetCredits != null && limits.resetCredits > 0 && (
          <ResetCreditsRow count={limits.resetCredits} credits={limits.resetCreditList} projectPath={projectPath} apiProviderId={apiProviderId} onConsumed={refresh} />
        )}
        {usage && <AccountUsageSection usage={usage} />}
        {(limits?.error || usage?.error) && <p className="text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function ClaudeRateLimitIcon({ credentialDir, remoteConnectionId, apiProviderId, status, tip: liveTip }: { credentialDir: string | null; remoteConnectionId: string | null; apiProviderId: string | null; status: string; tip: RateLimitTipInfo | null }) {
  const { t } = useTranslation()
  const [limits, setLimits] = useState<ClaudeRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const tip = useSubscriptionAlert(limits?.quotaKey ?? `claude:${credentialDir ?? 'default'}`, limits?.windows ?? [], liveTip, loaded)
  const highlight: GaugeHighlight = tip ? (tip.severity >= 2 ? 'error' : 'warning') : null
  // Only this session's own account; the subscription hub loads the other accounts on open.
  const [accountEmail, setAccountEmail] = useState<string | null>(null)

  const requestVersion = useRef(0)
  useEffect(() => () => { requestVersion.current++ }, [])
  const requestLimits = useCallback(async (force: boolean) => {
    const version = ++requestVersion.current
    if (force) setRefreshing(true)
    try {
      if (remoteConnectionId) {
        const report = await window.environment.getUsage(remoteConnectionId, force)
        if (version !== requestVersion.current) return
        const row = claudeSubscriptionFromReport(report, apiProviderId)
        setAccountEmail(row?.account ?? null)
        setLimits(row ? claudeLimitsFromSubscription(row) : unavailableNodeLimits(remoteConnectionId))
      } else {
        const next = await window.app.claudeGetRateLimits(force, credentialDir)
        if (version === requestVersion.current) setLimits(next)
      }
    } catch {
      // A remote read that fails stays on the node. Falling back would show this desktop's quota.
      if (remoteConnectionId && version === requestVersion.current) {
        setAccountEmail(null)
        setLimits(unavailableNodeLimits(remoteConnectionId))
      }
    }
    finally {
      if (version === requestVersion.current) { setLoaded(true); setRefreshing(false) }
    }
  }, [apiProviderId, credentialDir, remoteConnectionId])
  const fetchLimits = useCallback(() => { void requestLimits(false) }, [requestLimits])
  const refresh = useCallback(() => { void requestLimits(true) }, [requestLimits])

  useEffect(() => {
    setLimits(null)
    setLoaded(false)
    if (remoteConnectionId) {
      setAccountEmail(null)
      return
    }
    let cancelled = false
    window.app.claudeListAccounts()
      .then((accounts) => {
        if (cancelled) return
        const match = accounts.find((a) => a.credentialDir === credentialDir)
        // Always named, even with one account: the default domain's identity changes whenever the
        // user runs `claude /login` in their own terminal, and the meter is the only place that
        // says whose quota is being spent.
        setAccountEmail(match?.email ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [credentialDir, remoteConnectionId])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useRefetchOnTurnEnd(status, fetchLimits)

  const badgeWindow = limits?.windows.find((w) => w.label === '5h') ?? limits?.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null
  const hasUsage = Boolean(limits && (limits.windows.length > 0 || limits.error))
  const activeAccountKey = claudeHubKey(credentialDir)

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge
        title={<ProviderLabel brandKey="claude" size={14} />}
        label={t('usageGauge.claudeTitle')}
        subtitle={accountEmail}
        planType={limits?.planType ?? null}
        badgeRemaining={badgeRemaining}
        hasUsage={hasUsage}
        activeAccountKey={activeAccountKey}
        sessionWindows={limits?.windows ?? []}
        onOpen={refreshIfStale}
        onRefresh={hasUsage ? refresh : undefined}
        refreshing={refreshing}
        fetchedAt={limits?.fetchedAt ?? null}
        highlight={highlight}
      >
        {limits?.windows.map((w) => (
          <WindowRow key={w.id ?? w.label} {...w} />
        ))}
        {limits?.extraUsage && <ExtraUsageBar extra={limits.extraUsage} />}
        <ResetGrantsRow grants={limits?.resetGrants} />
        {limits?.error && <p className="text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function ProviderRateLimitIcon({ apiProviderId, status, tip, highlight }: { apiProviderId: string; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const load = useCallback((force: boolean) => window.app.providerGetRateLimits(apiProviderId, force), [apiProviderId])
  const { limits, refreshing, refresh, refreshIfStale } = useVersionedProviderLimits(load, status)

  const hasUsage = Boolean(limits && limits.windows.length > 0)
  const badgeWindow = limits?.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null
  const label = limits?.title ?? t('usageGauge.claudeTitle')
  const titleNode = limits?.title ?? <ProviderLabel brandKey="claude" size={14} />

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge
        title={titleNode}
        label={label}
        subtitle={limits?.email}
        planType={limits?.planType ?? null}
        badgeRemaining={badgeRemaining}
        hasUsage={hasUsage}
        sessionWindows={limits?.windows ?? []}
        onOpen={hasUsage ? refreshIfStale : undefined}
        onRefresh={hasUsage ? refresh : undefined}
        refreshing={refreshing}
        fetchedAt={limits?.fetchedAt ?? null}
        highlight={highlight}
      >
        {limits?.windows.map((w) => (
          <WindowRow key={w.id ?? w.label} {...w} />
        ))}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

type AcpHarnessId = 'acp-grok' | 'acp-antigravity'

function resolveAcpHarnessId(activeProvider: string | null | undefined, acpAgentId: string | null | undefined): AcpHarnessId | null {
  if (activeProvider === 'acp-grok') return 'acp-grok'
  if (activeProvider === 'acp-antigravity') return 'acp-antigravity'
  if (activeProvider !== 'acp' || !acpAgentId) return null
  if (isGrokAcpAgent(acpAgentId)) return 'acp-grok'
  if (isAntigravityAcpAgent(acpAgentId)) return 'acp-antigravity'
  return null
}

function AcpRateLimitIcon({ projectPath, harnessId, status, tip, highlight }: { projectPath: string; harnessId: AcpHarnessId; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath
  const agentId = harnessId === 'acp-antigravity' ? 'antigravity' : 'grok-build'
  const load = useCallback((force: boolean) => window.app.acpGetRateLimits(projectPathRef.current, agentId, force), [agentId])
  const { limits, refreshing, fetchLimits, refresh, refreshIfStale } = useVersionedProviderLimits(load, status)

  useEffect(() => {
    if (limits) return
    const timers = ACP_BILLING_RETRY_MS.map((ms) => window.setTimeout(fetchLimits, ms))
    return () => { for (const id of timers) window.clearTimeout(id) }
  }, [limits, fetchLimits])

  const hasUsage = Boolean(limits && (limits.windows.length > 0 || limits.extraUsage || limits.creditBalanceDollars != null))
  const badgeWindow = limits?.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null
  const label = limits?.title ?? t('usageGauge.windowFallback')

  const titleNode = harnessId === 'acp-grok'
    ? <ProviderLabel brandKey="grok" size={14} />
    : <ProviderLabel brandKey="antigravity" size={14} />

  const activeAccountKey = harnessId === 'acp-grok'
    ? 'acp:grok-build'
    : 'acp:antigravity'

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge
        title={titleNode}
        label={label}
        subtitle={limits ? (limits.account ?? limits.email) : null}
        planType={limits?.planType ?? null}
        badgeRemaining={badgeRemaining}
        hasUsage={hasUsage}
        activeAccountKey={activeAccountKey}
        sessionWindows={limits?.windows ?? []}
        onOpen={hasUsage ? refreshIfStale : undefined}
        onRefresh={hasUsage ? refresh : undefined}
        refreshing={refreshing}
        fetchedAt={limits?.fetchedAt ?? null}
        highlight={highlight}
      >
        {limits && (
          <>
            <GroupedWindowBars windows={limits.windows} />
            {limits.extraUsage && <ExtraUsageBar extra={limits.extraUsage} />}
            {limits.creditBalanceDollars != null && (
              <CreditBalanceRow dollars={limits.creditBalanceDollars} />
            )}
          </>
        )}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function UntrackedRateLimitIcon({ providerId, acpAgentId, tip, highlight }: { providerId: string | null; acpAgentId: string | null; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const brand = (acpAgentId && UNTRACKED_PROVIDER_BRAND[acpAgentId]) || (providerId && UNTRACKED_PROVIDER_BRAND[providerId]) || null
  const label = brand?.title ?? acpAgentId ?? t('usageGauge.windowFallback')
  const titleNode = brand?.brandKey
    ? <ProviderLabel brandKey={brand.brandKey} size={14} />
    : label

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge
        title={titleNode}
        label={label}
        planType={null}
        badgeRemaining={null}
        hasUsage={false}
        activeAccountKey={providerId ?? 'session:current'}
        highlight={highlight}
      />
    </RateLimitTipHost>
  )
}

export function UsageStatusIcon() {
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? null)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const codexThreadId = useActiveSession((s) => getLatestCodexThreadId(s.messages) ?? null)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const status = useActiveSession((s) => s.status)
  const rateLimitInfo = useActiveSession((s) => s.rateLimitInfo)
  const claudeApiProvider = useChatStore((s) => s.harnessResources.claude?.account?.apiProvider)
  const activeProvider = sessionProvider ?? preferredProvider
  const resolvedProviderId = useResolvedProviderId(activeProvider ?? 'claude')
  const apiProviderId = activeProvider === 'claude' ? resolvedProviderId : sessionApiProviderId

  const tip = useRateLimitTip(sessionId, rateLimitInfo)
  const highlight: GaugeHighlight = tip
    ? (tip.status === 'rejected' ? 'error' : 'warning')
    : null

  if (!activeProject) {
    return <UntrackedRateLimitIcon key={`untracked:${activeProvider ?? 'none'}:${acpAgentId ?? 'none'}`} providerId={activeProvider ?? null} acpAgentId={acpAgentId ?? null} tip={tip} highlight={highlight} />
  }
  const remoteProject = parseRemoteProjectKey(activeProject)

  if (activeProvider === 'codex') {
    return <CodexRateLimitIcon key={`${activeProject}:${apiProviderId ?? 'default'}`} projectPath={activeProject} apiProviderId={apiProviderId ?? null} threadId={codexThreadId} status={status} tip={rateLimitInfo} />
  }

  // A non-default Claude account carries an apiProviderId too, so "has an id" no longer means
  // "third-party gateway". Testing for the account prefix keeps those sessions on the first-party
  // meter instead of sending them down the provider path, which would ask a usage endpoint that
  // does not exist for them and silently drop the gauge.
  const claudeAccountDir = claudeAccountCredentialDir(apiProviderId)
  const thirdPartyClaude = Boolean(apiProviderId) && !isClaudeAccountProvider(apiProviderId)
  // A remote Claude session spends the node's login. The local first-party flag must not hide that
  // gauge, and it must not be what the gauge reads.
  if (activeProvider === 'claude' && !thirdPartyClaude && (remoteProject || isClaudeAccountProvider(apiProviderId) || (!apiProviderId && claudeApiProvider === 'firstParty'))) {
    return (
      <ClaudeRateLimitIcon
        key={remoteProject ? `remote:${remoteProject.connectionId}` : (claudeAccountDir ?? 'default')}
        credentialDir={claudeAccountDir}
        remoteConnectionId={remoteProject?.connectionId ?? null}
        apiProviderId={apiProviderId ?? null}
        status={status}
        tip={rateLimitInfo}
      />
    )
  }

  if (activeProvider === 'claude' && apiProviderId && !isClaudeAccountProvider(apiProviderId)) {
    return <ProviderRateLimitIcon key={apiProviderId} apiProviderId={apiProviderId} status={status} tip={tip} highlight={highlight} />
  }

  const acpHarnessId = resolveAcpHarnessId(activeProvider, acpAgentId)
  if (!remoteProject && acpHarnessId) {
    return <AcpRateLimitIcon key={acpHarnessId} projectPath={activeProject} harnessId={acpHarnessId} status={status} tip={tip} highlight={highlight} />
  }

  const untrackedKey = acpHarnessId ?? `${activeProvider ?? 'none'}:${acpAgentId ?? 'none'}`
  return <UntrackedRateLimitIcon key={`untracked:${untrackedKey}`} providerId={acpHarnessId ?? activeProvider ?? null} acpAgentId={acpAgentId ?? null} tip={tip} highlight={highlight} />
}
