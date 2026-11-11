import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'
import type { SubscriptionHarness, SubscriptionUsage } from '@superone/shared/environment'
import type { UsageWindow } from '@superone/shared/subscription-usage'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { ProviderLabel } from '../ProviderLabel'
import { formatWindowLabel } from '../provider-usage'
import { FORCE_REFRESH_ON_OPEN_STALE_MS } from './rate-limit-tip'
import {
  AccountCardWindows,
  ACP_HUB_AGENTS,
  claudeHubKey,
  codexHubKey,
  EmptyUsageState,
  nodeRowIsCurrentSession,
  PanelHeight,
  SUBSCRIPTION_BRANDS,
  SubscriptionGroup,
  subscriptionHubKey,
  type ClaudeMeterState,
  type CodexMeterState,
  type ProviderMeterState,
} from './usage-hub-shared'

export function SubscriptionAccountList({
  open,
  hasOpenedList,
  isRemoteProject,
  title,
  label,
  subtitle,
  planType,
  hasUsage,
  activeAccountKey,
  sessionWindows,
  selectedAccountKey,
  collapsedGroups,
  claudeAccounts,
  claudeMeters,
  codexAccounts,
  codexMeters,
  acpMeters,
  nodeUsage,
  showCurrentSessionGroup,
  onBackToDetail,
  onSelectAccountKey,
  onToggleGroup,
  loadNodeSubscriptions,
  loadClaudeMeter,
  loadCodexMeter,
  loadAcpMeter,
}: {
  open: boolean
  hasOpenedList: boolean
  isRemoteProject: boolean
  title: ReactNode
  label: string
  subtitle?: string | null
  planType: string | null
  hasUsage: boolean
  activeAccountKey: string
  sessionWindows: UsageWindow[]
  selectedAccountKey: string | null
  collapsedGroups: Record<string, boolean>
  claudeAccounts: ClaudeAccount[]
  claudeMeters: Record<string, ClaudeMeterState>
  codexAccounts: CodexAccount[]
  codexMeters: Record<string, CodexMeterState>
  acpMeters: Record<string, ProviderMeterState>
  nodeUsage: { accounts: SubscriptionUsage[]; loading: boolean; error: boolean }
  showCurrentSessionGroup: boolean
  onBackToDetail: () => void
  onSelectAccountKey: (key: string | null) => void
  onToggleGroup: (groupKey: string) => void
  loadNodeSubscriptions: (force: boolean) => Promise<void>
  loadClaudeMeter: (credentialDir: string | null, force: boolean, background: boolean) => Promise<void>
  loadCodexMeter: (accountId: string, force: boolean, background: boolean, includeUsage?: boolean) => Promise<void>
  loadAcpMeter: (agentId: string, force: boolean) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <PanelHeight open={open}>
      {hasOpenedList && (
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
            <button
              type="button"
              onClick={onBackToDetail}
              className="-mx-1.5 -mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
            >
              <ChevronLeft className="size-3.5 shrink-0 opacity-70" />
              <span>{t('usageGauge.allAccounts')}</span>
            </button>
          </div>

          <ScrollArea
            type="scroll"
            edgeFade
            className="sidebar-scroll -mx-2 max-h-104 min-h-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]]:px-2 [&_[data-slot=scroll-area-viewport]>div]:block!"
          >
            <div className="flex flex-col gap-3">
              {isRemoteProject && (
                <>
                  {nodeUsage.loading && <p role="status" className="text-muted-foreground">{t('usageGauge.updating')}</p>}
                  {nodeUsage.error && (
                    <div className="flex items-center justify-between gap-2">
                      <p role="status" className="text-muted-foreground">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>
                      <Button size="sm" variant="ghost" onClick={() => { void loadNodeSubscriptions(false) }}>{t('common.retry')}</Button>
                    </div>
                  )}
                  {!nodeUsage.loading && !nodeUsage.error && nodeUsage.accounts.length === 0 && <EmptyUsageState />}
                  {(Object.keys(SUBSCRIPTION_BRANDS) as SubscriptionHarness[]).map((harness) => {
                    const accounts = nodeUsage.accounts.filter((row) => row.harness === harness)
                    if (accounts.length === 0) return null
                    const brand = SUBSCRIPTION_BRANDS[harness]
                    return (
                      <SubscriptionGroup
                        key={harness}
                        title={<ProviderLabel brandKey={brand.brandKey} fallback={brand.title} size={12} />}
                        count={accounts.length}
                        collapsed={Boolean(collapsedGroups[harness])}
                        onToggle={() => onToggleGroup(harness)}
                      >
                        {accounts.map((row) => {
                          const key = subscriptionHubKey(row)
                          const isSelected = selectedAccountKey != null
                            ? selectedAccountKey === key
                            : nodeRowIsCurrentSession(row, activeAccountKey, nodeUsage.accounts)
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => { onSelectAccountKey(key); onBackToDetail() }}
                              className={cn(
                                'flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
                                isSelected ? 'border-primary/50 bg-accent/50' : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
                              )}
                            >
                              <div className="flex h-4 items-center justify-between gap-2">
                                <span className="truncate font-medium">{row.account || brand.title}</span>
                                {row.planType && <span className="shrink-0 text-[11px] capitalize opacity-50">{row.planType}</span>}
                              </div>
                              <AccountCardWindows windows={row.windows} />
                              {row.error && <p className="text-muted-foreground">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
                            </button>
                          )
                        })}
                      </SubscriptionGroup>
                    )
                  })}
                </>
              )}
              {!isRemoteProject && claudeAccounts.length > 0 && (
                <SubscriptionGroup
                  title={<ProviderLabel brandKey="claude" size={12} />}
                  count={claudeAccounts.length}
                  collapsed={Boolean(collapsedGroups.claude)}
                  onToggle={() => onToggleGroup('claude')}
                >
                  {claudeAccounts.map((account) => {
                    const key = claudeHubKey(account.credentialDir)
                    const isCurrent = activeAccountKey === key
                    const isSelected = selectedAccountKey ? selectedAccountKey === key : isCurrent
                    const meter = claudeMeters[key]
                    const meterLoading = meter ? Boolean(meter.loading) : !(isCurrent && sessionWindows.length > 0)
                    const windows = isCurrent && sessionWindows.length > 0 && !meter?.limits
                      ? sessionWindows
                      : (meter?.limits?.windows ?? [])
                    const plan = meter?.limits?.planType ?? account.subscriptionType ?? (isCurrent ? planType : null)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          if (isCurrent) {
                            onSelectAccountKey(null)
                          } else {
                            onSelectAccountKey(key)
                            const fetched = meter?.limits?.fetchedAt
                            if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS) {
                              void loadClaudeMeter(account.credentialDir, false, false)
                            }
                          }
                          onBackToDetail()
                        }}
                        className={cn(
                          'flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
                          isSelected
                            ? 'border-primary/50 bg-accent/50'
                            : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
                        )}
                      >
                        <div className="flex h-4 items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {account.email || t('resources.providers.claudePendingAccount')}
                          </span>
                          {plan ? (
                            <span className="shrink-0 text-[11px] capitalize opacity-50">{plan}</span>
                          ) : meterLoading ? (
                            <div className="h-2.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                          ) : null}
                        </div>
                        <AccountCardWindows windows={windows} loading={meterLoading} />
                      </button>
                    )
                  })}
                </SubscriptionGroup>
              )}

              {!isRemoteProject && codexAccounts.length > 0 && (
                <SubscriptionGroup
                  title={<ProviderLabel brandKey="openai" size={12} />}
                  count={codexAccounts.length}
                  collapsed={Boolean(collapsedGroups.openai)}
                  onToggle={() => onToggleGroup('openai')}
                >
                  {codexAccounts.map((account) => {
                    const providerId = codexAccountProviderId(account.id)
                    const key = codexHubKey(providerId)
                    const isCurrent = activeAccountKey === key || (activeAccountKey === 'codex:__default__' && account.isDefault)
                    const isSelected = selectedAccountKey ? selectedAccountKey === key : isCurrent
                    const meter = codexMeters[key]
                    const meterLoading = meter ? Boolean(meter.loading) : !(isCurrent && sessionWindows.length > 0)
                    const meterWindows: UsageWindow[] = [meter?.limits?.primary, meter?.limits?.secondary].flatMap(
                      (w) => w ? [{ ...w, label: formatWindowLabel(w.windowDurationMins, t) }] : [],
                    )
                    const windows = isCurrent && sessionWindows.length > 0 && meterWindows.length === 0
                      ? sessionWindows
                      : meterWindows
                    const plan = meter?.limits?.planType ?? account.planType ?? (isCurrent ? planType : null)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          if (isCurrent) {
                            onSelectAccountKey(null)
                          } else {
                            onSelectAccountKey(key)
                            const fetched = meter?.limits?.fetchedAt
                            if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS || meter?.usage === undefined) {
                              void loadCodexMeter(account.id, false, false, true)
                            }
                          }
                          onBackToDetail()
                        }}
                        className={cn(
                          'flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
                          isSelected
                            ? 'border-primary/50 bg-accent/50'
                            : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
                        )}
                      >
                        <div className="flex h-4 items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {account.email || t('usageGauge.codexTitle')}
                          </span>
                          {plan ? (
                            <span className="shrink-0 text-[11px] capitalize opacity-50">{plan}</span>
                          ) : meterLoading ? (
                            <div className="h-2.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                          ) : null}
                        </div>
                        <AccountCardWindows windows={windows} loading={meterLoading} />
                      </button>
                    )
                  })}
                </SubscriptionGroup>
              )}

              {!isRemoteProject && ACP_HUB_AGENTS.map((agent) => {
                const isCurrent = activeAccountKey === agent.key
                const meter = acpMeters[agent.key]
                const limits = meter?.limits
                const isInitialLoading = Boolean(meter?.loading) && !limits && !isCurrent
                if (!limits && !meter?.loading && !(isCurrent && hasUsage)) return null
                const isSelected = selectedAccountKey ? selectedAccountKey === agent.key : isCurrent
                const windows = limits?.windows?.length ? limits.windows : (isCurrent ? sessionWindows : [])
                const plan = limits?.planType ?? (isCurrent ? planType : null)
                const identity = limits?.account ?? limits?.email ?? (isCurrent ? subtitle : null) ?? limits?.title ?? agent.fallbackTitle
                return (
                  <SubscriptionGroup
                    key={agent.key}
                    title={<ProviderLabel brandKey={agent.brandKey} size={12} />}
                    count={1}
                    collapsed={Boolean(collapsedGroups[agent.key])}
                    onToggle={() => onToggleGroup(agent.key)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) {
                          onSelectAccountKey(null)
                        } else {
                          onSelectAccountKey(agent.key)
                          const fetched = limits?.fetchedAt
                          if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS) {
                            void loadAcpMeter(agent.agentId, false)
                          }
                        }
                        onBackToDetail()
                      }}
                      className={cn(
                        'flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
                        isSelected
                          ? 'border-primary/50 bg-accent/50'
                          : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
                      )}
                    >
                      {isInitialLoading ? (
                        <div className="flex h-4 items-center justify-between gap-2">
                          <div className="h-3 w-32 animate-pulse rounded bg-muted-foreground/20" />
                          <div className="h-2.5 w-12 animate-pulse rounded bg-muted-foreground/20" />
                        </div>
                      ) : (
                        <div className="flex h-4 items-center justify-between gap-2">
                          <span className="truncate font-medium">{identity}</span>
                          {plan && <span className="shrink-0 text-[11px] capitalize opacity-50">{plan}</span>}
                        </div>
                      )}
                      <AccountCardWindows windows={windows} loading={meter?.loading} />
                    </button>
                  </SubscriptionGroup>
                )
              })}

              {showCurrentSessionGroup && (
                <SubscriptionGroup
                  title={title}
                  count={1}
                  collapsed={Boolean(collapsedGroups.current)}
                  onToggle={() => onToggleGroup('current')}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectAccountKey(null)
                      onBackToDetail()
                    }}
                    className={cn(
                      'flex w-full flex-col gap-1.5 rounded-md border p-2 text-left transition-colors',
                      selectedAccountKey === null
                        ? 'border-primary/50 bg-accent/50'
                        : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
                    )}
                  >
                    <div className="flex h-4 items-center justify-between gap-2">
                      <span className="truncate font-medium">{subtitle || label}</span>
                      {planType && <span className="shrink-0 text-[11px] capitalize opacity-50">{planType}</span>}
                    </div>
                    <AccountCardWindows windows={sessionWindows} />
                  </button>
                </SubscriptionGroup>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </PanelHeight>
  )
}
