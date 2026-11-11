import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, RefreshCw } from 'lucide-react'
import { codexAccountProviderId } from '@superone/shared/codex-accounts'
import { USAGE_POLL_MS, type UsageWindow } from '@superone/shared/subscription-usage'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { ProviderLabel } from '../ProviderLabel'
import {
  ExtraUsageBar,
  formatWindowLabel,
  GroupedWindowBars,
  ResetGrantsRow,
  WindowBar as WindowRow,
} from '../provider-usage'
import type { GaugeHighlight } from './rate-limit-tip'
import { SubscriptionAccountList } from './subscription-account-list'
import {
  AccountUsageSection,
  ACP_HUB_AGENTS,
  claudeHubKey,
  codexHubKey,
  CreditBalanceRow,
  EmptyUsageState,
  formatUpdatedAgo,
  nodeRowIsCurrentSession,
  PanelHeight,
  ResetCreditsRow,
  SUBSCRIPTION_BRANDS,
  subscriptionHubKey,
} from './usage-hub-shared'
import { useSubscriptionHub } from './use-subscription-hub'

export function RateLimitGauge({
  title,
  label,
  subtitle,
  planType,
  badgeRemaining,
  hasUsage = true,
  activeAccountKey = 'session:current',
  sessionWindows = [],
  onOpen,
  onRefresh,
  refreshing,
  fetchedAt,
  highlight,
  children,
}: {
  title: ReactNode
  label: string
  subtitle?: string | null
  planType: string | null
  badgeRemaining: number | null
  hasUsage?: boolean
  activeAccountKey?: string
  sessionWindows?: UsageWindow[]
  onOpen?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  fetchedAt?: number | null
  highlight?: GaugeHighlight
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  const {
    isRemoteProject,
    localProjectPath,
    connectionId,
    claudeAccounts,
    claudeMeters,
    codexAccounts,
    codexMeters,
    acpMeters,
    nodeUsage,
    loadNodeSubscriptions,
    loadClaudeMeter,
    loadCodexMeter,
    loadAcpMeter,
    prefetchSubscriptions,
    ensurePrefetched,
  } = useSubscriptionHub(activeProject)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'detail' | 'list'>('detail')
  const [hasOpenedList, setHasOpenedList] = useState(false)
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setOpen(false)
    setView('detail')
    setHasOpenedList(false)
    setSelectedAccountKey(null)
  }, [connectionId])

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
  }, [])

  const handleOpenList = useCallback(() => {
    setHasOpenedList(true)
    setView('list')
    ensurePrefetched()
  }, [ensurePrefetched])

  const selectedClaudeAccount = !isRemoteProject && selectedAccountKey?.startsWith('claude:')
    ? claudeAccounts.find((a) => claudeHubKey(a.credentialDir) === selectedAccountKey) ?? null
    : null
  const selectedClaudeMeter = selectedAccountKey ? claudeMeters[selectedAccountKey] : undefined

  const selectedCodexAccount = !isRemoteProject && selectedAccountKey?.startsWith('codex:')
    ? codexAccounts.find((a) => codexHubKey(codexAccountProviderId(a.id)) === selectedAccountKey) ?? null
    : null
  const selectedCodexMeter = selectedAccountKey ? codexMeters[selectedAccountKey] : undefined

  const selectedAcpAgent = !isRemoteProject && selectedAccountKey?.startsWith('acp:')
    ? ACP_HUB_AGENTS.find((a) => a.key === selectedAccountKey) ?? null
    : null
  const selectedAcpMeter = selectedAccountKey ? acpMeters[selectedAccountKey] : undefined
  const selectedNodeSubscription = isRemoteProject
    ? nodeUsage.accounts.find((row) => subscriptionHubKey(row) === selectedAccountKey)
    : undefined

  const activeFetchedAt = selectedNodeSubscription
    ? null
    : selectedClaudeAccount
      ? (selectedClaudeMeter?.limits?.fetchedAt ?? null)
      : selectedCodexAccount
        ? (selectedCodexMeter?.limits?.fetchedAt ?? null)
        : selectedAcpAgent
          ? (selectedAcpMeter?.limits?.fetchedAt ?? null)
          : fetchedAt

  useEffect(() => {
    if (!open || activeFetchedAt == null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open, activeFetchedAt])

  useEffect(() => {
    if (!open || !onOpen) return
    const timer = window.setInterval(onOpen, USAGE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, onOpen])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      onOpen?.()
      prefetchSubscriptions()
    } else {
      setView('detail')
      setHasOpenedList(false)
      setSelectedAccountKey(null)
    }
  }, [onOpen, prefetchSubscriptions])

  const detailTitle = selectedNodeSubscription
    ? <ProviderLabel brandKey={SUBSCRIPTION_BRANDS[selectedNodeSubscription.harness].brandKey} fallback={SUBSCRIPTION_BRANDS[selectedNodeSubscription.harness].title} size={14} />
    : selectedClaudeAccount
      ? <ProviderLabel brandKey="claude" size={14} />
      : selectedCodexAccount
        ? <ProviderLabel brandKey="openai" size={14} />
        : selectedAcpAgent
          ? <ProviderLabel brandKey={selectedAcpAgent.brandKey} size={14} />
          : title
  const detailPlan = selectedNodeSubscription
    ? selectedNodeSubscription.planType
    : selectedClaudeAccount
      ? (selectedClaudeMeter?.limits?.planType ?? selectedClaudeAccount.subscriptionType ?? null)
      : selectedCodexAccount
        ? (selectedCodexMeter?.limits?.planType ?? selectedCodexAccount.planType ?? null)
        : selectedAcpAgent
          ? (selectedAcpMeter?.limits?.planType ?? null)
          : planType
  const detailSubtitle = selectedNodeSubscription
    ? selectedNodeSubscription.account
    : selectedClaudeAccount
      ? [selectedClaudeAccount.email, selectedClaudeAccount.orgName].filter(Boolean).join(' · ')
      : selectedCodexAccount
        ? (selectedCodexAccount.email ?? null)
        : selectedAcpAgent
          ? (selectedAcpMeter?.limits?.account ?? selectedAcpMeter?.limits?.email ?? null)
          : subtitle
  const detailRefreshing = selectedNodeSubscription
    ? nodeUsage.loading
    : selectedClaudeAccount
      ? Boolean(selectedClaudeMeter?.loading)
      : selectedCodexAccount
        ? Boolean(selectedCodexMeter?.loading)
        : selectedAcpAgent
          ? Boolean(selectedAcpMeter?.loading)
          : refreshing
  const detailOnRefresh = selectedNodeSubscription
    ? () => { void loadNodeSubscriptions(true) }
    : selectedClaudeAccount
      ? () => { void loadClaudeMeter(selectedClaudeAccount.credentialDir, true, false) }
      : selectedCodexAccount
        ? () => { void loadCodexMeter(selectedCodexAccount.id, true, false, true) }
        : selectedAcpAgent
          ? () => { void loadAcpMeter(selectedAcpAgent.agentId, true) }
          : onRefresh

  const renderDetailBody = (): ReactNode => {
    if (selectedNodeSubscription) {
      return (
        <>
          {selectedNodeSubscription.windows.length > 0 ? <GroupedWindowBars windows={selectedNodeSubscription.windows} /> : <EmptyUsageState />}
          {(selectedNodeSubscription.error || nodeUsage.error) && <p className="text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
        </>
      )
    }
    if (selectedClaudeAccount) {
      const limits = selectedClaudeMeter?.limits
      const hasData = Boolean(limits && (limits.windows.length > 0 || limits.extraUsage || limits.error))
      if (!hasData) return <EmptyUsageState />
      return (
        <>
          {limits!.windows.map((w) => (
            <WindowRow key={w.id ?? w.label} {...w} />
          ))}
          {limits!.extraUsage && <ExtraUsageBar extra={limits!.extraUsage} />}
          <ResetGrantsRow grants={limits!.resetGrants} />
          {limits!.error && <p className="text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
        </>
      )
    }
    if (selectedCodexAccount) {
      const limits = selectedCodexMeter?.limits
      const usage = selectedCodexMeter?.usage
      const hasData = Boolean((limits && (limits.primary || limits.secondary || limits.error)) || usage)
      if (!hasData) return <EmptyUsageState />
      const providerId = codexAccountProviderId(selectedCodexAccount.id)
      return (
        <>
          {limits?.primary && (
            <WindowRow {...limits.primary} label={formatWindowLabel(limits.primary.windowDurationMins, t)} />
          )}
          {limits?.secondary && (
            <WindowRow {...limits.secondary} label={formatWindowLabel(limits.secondary.windowDurationMins, t)} />
          )}
          {limits?.resetCredits != null && limits.resetCredits > 0 && localProjectPath && (
            <ResetCreditsRow
              count={limits.resetCredits}
              credits={limits.resetCreditList}
              projectPath={localProjectPath}
              apiProviderId={providerId}
              onConsumed={() => { void loadCodexMeter(selectedCodexAccount.id, true, false, true) }}
            />
          )}
          {usage && <AccountUsageSection usage={usage} />}
          {(limits?.error || usage?.error) && <p className="text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
        </>
      )
    }
    if (selectedAcpAgent) {
      const limits = selectedAcpMeter?.limits
      const hasData = Boolean(limits && (limits.windows.length > 0 || limits.extraUsage || limits.creditBalanceDollars != null))
      if (!hasData) return <EmptyUsageState />
      return (
        <>
          <GroupedWindowBars windows={limits!.windows} />
          {limits!.extraUsage && <ExtraUsageBar extra={limits!.extraUsage} />}
          {limits!.creditBalanceDollars != null && (
            <CreditBalanceRow dollars={limits!.creditBalanceDollars} />
          )}
        </>
      )
    }
    return hasUsage ? children : <EmptyUsageState />
  }

  const isClaudeActiveInList = claudeAccounts.some((a) => claudeHubKey(a.credentialDir) === activeAccountKey)
  const isCodexActiveInList = codexAccounts.some(
    (a) => codexHubKey(codexAccountProviderId(a.id)) === activeAccountKey || (activeAccountKey === 'codex:__default__' && a.isDefault),
  )
  const isAcpActiveInList = ACP_HUB_AGENTS.some(
    (agent) => activeAccountKey === agent.key && (Boolean(acpMeters[agent.key]?.limits) || Boolean(acpMeters[agent.key]?.loading) || hasUsage),
  )
  const isNodeActiveInList = isRemoteProject && nodeUsage.accounts.some((row) => nodeRowIsCurrentSession(row, activeAccountKey, nodeUsage.accounts))
  const showCurrentSessionGroup = isRemoteProject
    ? !isNodeActiveInList
    : !isClaudeActiveInList && !isCodexActiveInList && !isAcpActiveInList

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          aria-label={label}
          className={cn(
            'transition-colors',
            badgeRemaining != null && 'h-6 w-auto gap-1 px-1.5',
            highlight === 'warning' && 'border border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning',
            highlight === 'error' && 'border border-error/40 bg-error/10 text-error hover:bg-error/15 hover:text-error',
          )}
        >
          <Gauge />
          {badgeRemaining != null && (
            <span className="text-[11px] font-medium tabular-nums">{badgeRemaining}%</span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex w-76 min-w-76 flex-col text-xs">
          <PanelHeight open={view === 'detail'}>
            <div className="flex flex-col gap-2 p-3">
              <button
                type="button"
                aria-label={t('usageGauge.switchAccount')}
                onClick={handleOpenList}
                className="-mx-1.5 -mt-1.5 flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    {detailTitle}
                  </span>
                  {detailPlan && <span className="shrink-0 opacity-50">{detailPlan}</span>}
                </div>
                {detailSubtitle && <span className="truncate opacity-50">{detailSubtitle}</span>}
              </button>
              {renderDetailBody()}
              {(detailOnRefresh || detailRefreshing || activeFetchedAt != null) && (
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                  <span className="text-[10px] tabular-nums opacity-50">
                    {detailRefreshing ? t('usageGauge.updating') : activeFetchedAt != null ? formatUpdatedAgo(activeFetchedAt, now, t) : ''}
                  </span>
                  {detailOnRefresh && (
                    <IconButton size="xs" variant="ghost" tooltip={t('common.refresh')} aria-label={t('common.refresh')} disabled={detailRefreshing} onClick={detailOnRefresh}>
                      <RefreshCw className={cn(detailRefreshing && 'animate-spin')} />
                    </IconButton>
                  )}
                </div>
              )}
            </div>
          </PanelHeight>

          <SubscriptionAccountList
            open={view === 'list'}
            hasOpenedList={hasOpenedList}
            isRemoteProject={isRemoteProject}
            title={title}
            label={label}
            subtitle={subtitle}
            planType={planType}
            hasUsage={hasUsage}
            activeAccountKey={activeAccountKey}
            sessionWindows={sessionWindows}
            selectedAccountKey={selectedAccountKey}
            collapsedGroups={collapsedGroups}
            claudeAccounts={claudeAccounts}
            claudeMeters={claudeMeters}
            codexAccounts={codexAccounts}
            codexMeters={codexMeters}
            acpMeters={acpMeters}
            nodeUsage={nodeUsage}
            showCurrentSessionGroup={showCurrentSessionGroup}
            onBackToDetail={() => setView('detail')}
            onSelectAccountKey={setSelectedAccountKey}
            onToggleGroup={toggleGroup}
            loadNodeSubscriptions={loadNodeSubscriptions}
            loadClaudeMeter={loadClaudeMeter}
            loadCodexMeter={loadCodexMeter}
            loadAcpMeter={loadAcpMeter}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
