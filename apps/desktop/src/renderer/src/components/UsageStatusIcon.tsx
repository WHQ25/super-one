import { useResolvedProviderId } from './chat/model-selector/useSelectorProviders'
import { codexAccountProviderId, isCodexAccountProvider, type CodexAccount } from '@superone/shared/codex-accounts'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AlertTriangle, ChevronDown, ChevronLeft, Gauge, OctagonX, RefreshCw } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { getLatestCodexThreadId, useActiveSession, useChatStore } from '@/stores/chat'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { claudeLimitsFromSubscription, claudeSubscriptionFromReport, unavailableNodeLimits } from '@/harness-ui/claude/remote-subscription-usage'
import { claudeAccountCredentialDir, isClaudeAccountProvider } from '@superone/shared/agent-types'
import type { ClaudeAccount, ClaudeRateLimits, CodexAccountUsage, CodexRateLimitResetCredit, CodexRateLimitResetOutcome, CodexRateLimits, ProviderRateLimits } from '@superone/shared/agent-types'
import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { ProviderLabel } from './ProviderLabel'
import { ExtraUsageBar, formatCreditExpiry, formatTokens, formatWindowLabel, GroupedWindowBars, ResetGrantsRow, WindowBar as WindowRow } from './provider-usage'
import { USAGE_POLL_MS, usageWindowTone, type UsageWindow } from '@superone/shared/subscription-usage'
import { formatUsageDuration } from '@superone/shared/subscription-usage-presentation'
import { useSubscriptionAlert } from './use-subscription-alert'
import type { SubscriptionAlert } from '@superone/shared/subscription-alerts'
import type { SubscriptionHarness, SubscriptionUsage } from '@superone/shared/environment'
import { useCodexUsage } from './use-codex-usage'
import { codexRowMatchesOmittedAccount } from '@/harness-ui/codex/node-account'

const TAB_PANEL_SPRING = { type: 'spring', bounce: 0.15, duration: 0.3 } as const
const TONE_BAR_CLASS = { success: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500' } as const

const FORCE_REFRESH_ON_OPEN_STALE_MS = 5 * 60 * 1000
const RATE_LIMIT_TIP_MS = 6_000
const ACP_BILLING_RETRY_MS = [2_000, 6_000] as const

type RateLimitTipInfo = Partial<Pick<SubscriptionAlert, 'source' | 'windowId' | 'label' | 'exhaustsAt' | 'severity'>> & {
  status: 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
}

type GaugeHighlight = 'warning' | 'error' | null

const RESET_OUTCOME_TOAST: Record<CodexRateLimitResetOutcome, { kind: 'success' | 'info' | 'error'; key: string }> = {
  reset: { kind: 'success', key: 'usageGauge.toast.reset' },
  nothingToReset: { kind: 'info', key: 'usageGauge.toast.nothingToReset' },
  noCredit: { kind: 'info', key: 'usageGauge.toast.noCredit' },
  alreadyRedeemed: { kind: 'info', key: 'usageGauge.toast.alreadyRedeemed' },
  unknown: { kind: 'error', key: 'usageGauge.toast.unknown' },
}

function formatUpdatedAgo(fetchedAt: number, now: number, t: TFunction): string {
  const min = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (min < 1) return t('usageGauge.updatedJustNow')
  if (min < 60) return t('usageGauge.updatedMinutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('usageGauge.updatedHoursAgo', { n: hr })
  return t('usageGauge.updatedDaysAgo', { n: Math.floor(hr / 24) })
}

function formatResetTime(resetsAt?: number): string | null {
  if (!resetsAt) return null
  const date = new Date(resetsAt * 1000)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date)
}

function remainingPercent(usedPercent: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 - usedPercent)))
}

function rateLimitTipKey(info: RateLimitTipInfo): string {
  if (info.source === 'forecast') return `forecast:${info.windowId}:${info.resetsAt}:${info.severity}`
  return `${info.status}:${info.resetsAt ?? ''}:${info.rateLimitType ?? ''}:${info.utilization != null ? Math.floor(info.utilization * 20) : ''}`
}

/** Past resetsAt means the window already recovered — do not re-tip stale episodes. */
function isExpiredRateLimit(info: RateLimitTipInfo): boolean {
  return info.resetsAt != null && info.resetsAt * 1000 <= Date.now()
}

/**
 * Show a rate-limit tip for 6s when session rateLimitInfo changes; auto-dismiss
 * with no residual highlight.
 *
 * Dismissal is keyed per session so switching away (active session has no
 * rateLimitInfo → null) and back does not re-fire a tip the user already saw.
 * Clearing rateLimitInfo on a given session ends that session's episode, so a
 * later hit (e.g. Grok rejected → allowed → rejected) tips again.
 */
function useRateLimitTip(sessionId: string | null, info: RateLimitTipInfo | null): RateLimitTipInfo | null {
  const [dismissedBySession, setDismissedBySession] = useState<Map<string, string>>(() => new Map())
  const activeInfo = info && !isExpiredRateLimit(info) ? info : null
  const key = activeInfo ? rateLimitTipKey(activeInfo) : null
  const dismissedKey = sessionId ? dismissedBySession.get(sessionId) ?? null : null
  const visible = !!sessionId && !!activeInfo && key != null && key !== dismissedKey

  useEffect(() => {
    if (!visible || !key || !sessionId) return
    const timer = window.setTimeout(() => {
      setDismissedBySession((prev) => {
        if (prev.get(sessionId) === key) return prev
        const next = new Map(prev)
        next.set(sessionId, key)
        return next
      })
    }, RATE_LIMIT_TIP_MS)
    return () => window.clearTimeout(timer)
  }, [visible, key, sessionId])

  // Episode ended for this session only — other sessions keep their dismiss keys.
  useEffect(() => {
    if (!sessionId || activeInfo) return
    setDismissedBySession((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, activeInfo])

  return visible ? activeInfo : null
}

/** Remaining prepaid ("bought") credits — spends after the included pool is gone. */
function CreditBalanceRow({ dollars }: { dollars: number }) {
  const { t } = useTranslation()
  return <StatRow label={t('usageGauge.creditBalance')} value={`$${dollars.toFixed(2)}`} />
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function ResetCreditsRow({ count, credits, projectPath, apiProviderId, onConsumed }: { count: number; credits?: CodexRateLimitResetCredit[]; projectPath: string; apiProviderId: string | null; onConsumed: () => void }) {
  const { t } = useTranslation()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleReset = useCallback(async (creditId?: string) => {
    setBusyId(creditId ?? '__all__')
    try {
      const outcome = await window.app.codexConsumeRateLimitReset(projectPath, apiProviderId, creditId)
      const feedback = RESET_OUTCOME_TOAST[outcome ?? 'unknown']
      toast[feedback.kind](t(feedback.key))
      onConsumed()
    } catch {
      toast.error(t(RESET_OUTCOME_TOAST.unknown.key))
    } finally {
      setBusyId(null)
    }
  }, [projectPath, apiProviderId, onConsumed, t])

  const redeemable = credits?.filter((c) => c.status !== 'redeemed')
  if (redeemable && redeemable.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="opacity-70">{t('usageGauge.resetCredits')}</span>
        {redeemable.map((credit) => {
          const busy = busyId === credit.id
          return (
            <div key={credit.id} className="flex items-center justify-between gap-3 pl-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{credit.title ?? t('usageGauge.resetCreditDefault')}</span>
                {credit.expiresAt != null && (
                  <span className="text-[11px] opacity-60">{t('usageGauge.resetCreditExpires', { date: formatCreditExpiry(credit.expiresAt) })}</span>
                )}
              </div>
              <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" disabled={busy || credit.status !== 'available'} onClick={() => handleReset(credit.id)}>
                {busy || credit.status === 'redeeming' ? t('usageGauge.resetting') : t('usageGauge.resetNow')}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{t('usageGauge.resetCredits')}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{count}</span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busyId !== null} onClick={() => handleReset()}>
          {busyId !== null ? t('usageGauge.resetting') : t('usageGauge.resetNow')}
        </Button>
      </div>
    </div>
  )
}

function AccountUsageSection({ usage }: { usage: CodexAccountUsage }) {
  const { t } = useTranslation()
  const rows: ReactNode[] = []
  if (usage.lifetimeTokens != null) rows.push(<StatRow key="lifetime" label={t('usageGauge.lifetimeTokens')} value={formatTokens(usage.lifetimeTokens)} />)
  if (usage.peakDailyTokens != null) rows.push(<StatRow key="peak" label={t('usageGauge.peakDaily')} value={formatTokens(usage.peakDailyTokens)} />)
  if (usage.currentStreakDays != null) rows.push(<StatRow key="streak" label={t('usageGauge.streak')} value={`${usage.currentStreakDays}d`} />)
  if (usage.threadUsage) {
    const threadTokens = usage.threadUsage.groups.reduce((total, group) => total + (group.totalTokens ?? 0), 0)
    if (threadTokens > 0) rows.push(<StatRow key="thread-tokens" label={t('usageGauge.threadTokens')} value={formatTokens(threadTokens)} />)
    rows.push(<StatRow
      key="thread-credits"
      label={t('usageGauge.estimatedCredits')}
      value={(usage.threadUsage.estimatedUsageCreditsMicros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })}
    />)
  }
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">{rows}</div>
  )
}

function RateLimitTipBubble({ tip }: { tip: RateLimitTipInfo }) {
  const { t } = useTranslation()
  const isRejected = tip.status === 'rejected'
  const isUrgent = isRejected || (tip.severity ?? 0) >= 2
  const resetLabel = formatResetTime(tip.resetsAt)
  const pct = tip.utilization != null ? Math.round(tip.utilization * 100) : null
  const title = isRejected ? t('usageGauge.rateLimit.limited') : tip.source === 'forecast' ? t('usageGauge.forecast.warning') : t('usageGauge.rateLimit.approaching')
  const details = [
    tip.label,
    tip.source === 'forecast' && tip.exhaustsAt != null ? t('usageGauge.forecast.eta', { time: formatUsageDuration(tip.exhaustsAt - Date.now()) }) : null,
    !isRejected && tip.source !== 'forecast' && pct != null ? t('usageGauge.rateLimit.percentUsed', { percent: pct }) : null,
    resetLabel ? t('usageGauge.rateLimit.resetsAt', { time: resetLabel }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <PopoverContent
      role="status"
      side="top"
      align="end"
      sideOffset={8}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="pointer-events-none w-52 rounded-md border-0 bg-background p-2 text-xs shadow-none"
    >
      <div className="flex items-start gap-1.5">
        {isRejected
          ? <OctagonX className="mt-0.5 size-3.5 shrink-0 text-error" />
          : <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', isUrgent ? 'text-error' : 'text-warning')} />
        }
        <div className="min-w-0">
          <div className={cn('font-medium', isUrgent ? 'text-error' : 'text-warning')}>{title}</div>
          {details && <div className="mt-0.5 text-[11px] text-muted-foreground">{details}</div>}
        </div>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/60">
        <motion.div
          key={rateLimitTipKey(tip)}
          className={cn('h-full origin-left', isUrgent ? 'bg-error' : 'bg-warning')}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: RATE_LIMIT_TIP_MS / 1000, ease: 'linear' }}
        />
      </div>
    </PopoverContent>
  )
}

function RateLimitTipHost({ tip, children }: { tip: RateLimitTipInfo | null; children: ReactNode }) {
  if (!children) return null
  return (
    <Popover open={tip !== null}>
      <PopoverAnchor asChild>
        <div>{children}</div>
      </PopoverAnchor>
      {tip && <RateLimitTipBubble key={rateLimitTipKey(tip)} tip={tip} />}
    </Popover>
  )
}

const UNTRACKED_PROVIDER_BRAND: Record<string, { brandKey?: string; title: string }> = {
  claude: { brandKey: 'claude', title: 'Claude' },
  codex: { brandKey: 'openai', title: 'Codex' },
  cursor: { brandKey: 'cursor', title: 'Cursor' },
  opencode: { title: 'OpenCode' },
  dsh: { title: 'DSH' },
}

const ACP_HUB_AGENTS = [
  { agentId: 'grok-build', key: 'acp:grok-build', brandKey: 'grok', fallbackTitle: 'Grok Build' },
  { agentId: 'antigravity', key: 'acp:antigravity', brandKey: 'antigravity', fallbackTitle: 'Antigravity' },
] as const

function claudeHubKey(credentialDir: string | null | undefined): string {
  return `claude:${credentialDir ?? '__default__'}`
}

function codexHubKey(apiProviderId: string | null | undefined): string {
  return `codex:${apiProviderId ?? '__default__'}`
}

const SUBSCRIPTION_BRANDS: Record<SubscriptionHarness, { brandKey?: string; title: string }> = {
  claude: { brandKey: 'claude', title: 'Claude' },
  codex: { brandKey: 'openai', title: 'Codex' },
  grok: { brandKey: 'grok', title: 'Grok' },
  cursor: { brandKey: 'cursor', title: 'Cursor' },
  opencode: { title: 'OpenCode' },
}

const SUBSCRIPTION_HUB_KEY: Record<SubscriptionHarness, (row: SubscriptionUsage) => string> = {
  claude: (row) => claudeHubKey(claudeAccountCredentialDir(row.apiProviderId)),
  codex: (row) => codexHubKey(row.apiProviderId),
  grok: () => 'acp:grok-build',
  cursor: (row) => row.harness,
  opencode: (row) => row.harness,
}

function subscriptionHubKey(row: SubscriptionUsage): string {
  return SUBSCRIPTION_HUB_KEY[row.harness](row)
}

/**
 * A Codex session that omits its account id spends the node's default login.
 * That login is still reported as `codex-account:…`, so the hub key alone misses it
 * and the list draws a second OpenAI card with no email.
 * An older node omits `isDefault`; the only Codex row is that login.
 */
function nodeRowIsCurrentSession(row: SubscriptionUsage, activeAccountKey: string, accounts: readonly SubscriptionUsage[]): boolean {
  if (subscriptionHubKey(row) === activeAccountKey) return true
  return codexRowMatchesOmittedAccount(row, accounts, activeAccountKey === codexHubKey(null))
}

function PanelHeight({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? 'auto' : 0 }}
      transition={reduceMotion ? { duration: 0 } : TAB_PANEL_SPRING}
      className="overflow-hidden"
      data-slot="usage-hub-panel"
    >
      <div inert={!open ? true : undefined} aria-hidden={!open}>
        {children}
      </div>
    </motion.div>
  )
}

function AccountCardWindows({ windows, loading }: { windows: UsageWindow[]; loading?: boolean }) {
  const { t } = useTranslation()
  const [now] = useState(Date.now)
  const primary = windows.find((w) => w.label === '5h') ?? windows[0]
  if (primary) {
    const remaining = remainingPercent(primary.usedPercent)
    const tone = usageWindowTone(primary, now)
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex h-4 items-center justify-between gap-2 text-[11px]">
          <span className="opacity-70">{primary.label}</span>
          <span className="font-medium tabular-nums">{remaining}%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
          <div className={cn('h-full rounded-full transition-all', TONE_BAR_CLASS[tone])} style={{ width: `${remaining}%` }} />
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-0.5" aria-label={t('usageGauge.updating')}>
        <div className="flex h-4 items-center justify-between gap-2">
          <div className="h-2.5 w-16 animate-pulse rounded bg-muted-foreground/20" />
          <div className="h-2.5 w-8 animate-pulse rounded bg-muted-foreground/20" />
        </div>
        <div className="h-1 w-full animate-pulse rounded-full bg-muted-foreground/20" />
      </div>
    )
  }
  return (
    <div className="flex h-[22px] items-center text-[11px] text-muted-foreground">
      {t('usageGauge.noUsageInfo')}
    </div>
  )
}

function EmptyUsageState() {
  const { t } = useTranslation()
  return (
    <div className="rounded-md bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
      {t('usageGauge.noUsageInfo')}
    </div>
  )
}

function SubscriptionGroup({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: ReactNode
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="-mx-1.5 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {title}
          {count > 1 && (
            <span className="text-[10px] tabular-nums opacity-60">
              {t('usageGauge.accountCount', { n: count })}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 opacity-60 transition-transform duration-200',
            collapsed && '-rotate-90',
          )}
        />
      </button>
      <PanelHeight open={!collapsed}>
        <div className="flex flex-col gap-1.5 pt-1">
          {children}
        </div>
      </PanelHeight>
    </div>
  )
}

let cachedClaudeAccounts: ClaudeAccount[] = []
let cachedCodexAccounts: CodexAccount[] = []

function RateLimitGauge({
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
  /** Text, or a brand lockup for providers we ship an icon for. */
  title: ReactNode
  /** Accessible name for the trigger. Required because `title` may render as artwork only. */
  label: string
  /** Identity line under the title — which account these numbers belong to. */
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
  const remoteProject = activeProject ? parseRemoteProjectKey(activeProject) : null
  const isRemoteProject = Boolean(remoteProject)
  const localProjectPath = !isRemoteProject ? activeProject : null
  const connectionId = remoteProject?.connectionId ?? null

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'detail' | 'list'>('detail')
  const [hasOpenedList, setHasOpenedList] = useState(false)
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [claudeAccounts, setClaudeAccounts] = useState<ClaudeAccount[]>(() => (
    !isRemoteProject && typeof window !== 'undefined' && typeof window.app?.claudeListAccounts === 'function'
      ? cachedClaudeAccounts
      : []
  ))
  const [claudeMeters, setClaudeMeters] = useState<Record<string, { loading?: boolean; limits?: ClaudeRateLimits | null }>>({})
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>(() => (
    !isRemoteProject && typeof window !== 'undefined' && typeof window.app?.codexListAccounts === 'function'
      ? cachedCodexAccounts
      : []
  ))
  const [codexMeters, setCodexMeters] = useState<Record<string, { loading?: boolean; limits?: CodexRateLimits | null; usage?: CodexAccountUsage | null }>>({})
  const [acpMeters, setAcpMeters] = useState<Record<string, { loading?: boolean; limits?: ProviderRateLimits | null }>>({})
  const [now, setNow] = useState(() => Date.now())
  const prefetchedRef = useRef(false)
  const [nodeUsage, setNodeUsage] = useState<{
    accounts: SubscriptionUsage[]; loading: boolean; error: boolean
  }>({ accounts: [], loading: false, error: false })
  const nodeRequestVersion = useRef(0)

  useEffect(() => {
    prefetchedRef.current = false
    setOpen(false)
    setView('detail')
    setHasOpenedList(false)
    setSelectedAccountKey(null)
    setNodeUsage({ accounts: [], loading: false, error: false })
    return () => { nodeRequestVersion.current++ }
  }, [connectionId])

  const loadNodeSubscriptions = useCallback(async (force: boolean) => {
    if (!connectionId) return
    const version = ++nodeRequestVersion.current
    setNodeUsage((prev) => ({ ...prev, loading: true, error: false }))
    try {
      const report = await window.environment.getUsage(connectionId, force)
      if (version !== nodeRequestVersion.current) return
      setNodeUsage({ accounts: report.accounts, loading: false, error: false })
    } catch {
      if (version !== nodeRequestVersion.current) return
      setNodeUsage((prev) => ({ ...prev, loading: false, error: true }))
    }
  }, [connectionId])

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
  }, [])

  const loadClaudeMeter = useCallback(async (credentialDir: string | null, force: boolean, preferCached: boolean) => {
    const key = claudeHubKey(credentialDir)
    setClaudeMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limits = await window.app?.claudeGetRateLimits?.(force, credentialDir, preferCached) ?? null
      setClaudeMeters((prev) => ({ ...prev, [key]: { loading: false, limits } }))
    } catch {
      setClaudeMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [])

  const loadCodexMeter = useCallback(async (accountId: string, force: boolean, preferCached: boolean, includeUsage = false) => {
    if (!localProjectPath) return
    const providerId = codexAccountProviderId(accountId)
    const key = codexHubKey(providerId)
    setCodexMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limitsPromise = window.app?.codexGetRateLimits?.(localProjectPath, providerId, force, preferCached) ?? Promise.resolve(null)
      const usagePromise = includeUsage
        ? (window.app?.codexGetAccountUsage?.(localProjectPath, providerId, null, force, preferCached) ?? Promise.resolve(null))
        : Promise.resolve(undefined)
      const limits = await limitsPromise.catch(() => null)
      setCodexMeters((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          loading: false,
          limits: limits ?? prev[key]?.limits ?? null,
        },
      }))
      if (includeUsage) {
        const usage = await usagePromise.catch(() => null)
        if (usage !== undefined) {
          setCodexMeters((prev) => ({
            ...prev,
            [key]: {
              ...prev[key],
              usage: usage ?? prev[key]?.usage ?? null,
            },
          }))
        }
      }
    } catch {
      setCodexMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [localProjectPath])

  const loadAcpMeter = useCallback(async (agentId: string, force: boolean) => {
    const key = `acp:${agentId}`
    setAcpMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limits = await window.app?.acpGetRateLimits?.(localProjectPath ?? '', agentId, force) ?? null
      setAcpMeters((prev) => ({ ...prev, [key]: { loading: false, limits } }))
    } catch {
      setAcpMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [localProjectPath])

  // Preload account lists on mount so all subscription cards render immediately when opening the list view.
  useEffect(() => {
    if (isRemoteProject) {
      setClaudeAccounts((prev) => (prev.length === 0 ? prev : []))
      setCodexAccounts((prev) => (prev.length === 0 ? prev : []))
      return
    }
    let cancelled = false
    const refreshClaude = () => {
      if (typeof window.app?.claudeListAccounts !== 'function') {
        cachedClaudeAccounts = []
        setClaudeAccounts((prev) => (prev.length === 0 ? prev : []))
        return
      }
      window.app.claudeListAccounts(false)
        .then((accounts) => {
          if (cancelled) return
          const signedIn = (accounts ?? []).filter((a) => a.loggedIn)
          cachedClaudeAccounts = signedIn
          setClaudeAccounts(signedIn)
        })
        .catch(() => {})
    }
    const refreshCodex = () => {
      if (typeof window.app?.codexListAccounts !== 'function') {
        cachedCodexAccounts = []
        setCodexAccounts((prev) => (prev.length === 0 ? prev : []))
        return
      }
      window.app.codexListAccounts(localProjectPath ?? '', false)
        .then((accounts) => {
          if (cancelled) return
          const signedIn = (accounts ?? []).filter((a) => a.signedIn && !a.unavailable)
          cachedCodexAccounts = signedIn
          setCodexAccounts(signedIn)
        })
        .catch(() => {})
    }
    refreshClaude()
    refreshCodex()
    window.addEventListener('codex-accounts-changed', refreshCodex)
    return () => {
      cancelled = true
      window.removeEventListener('codex-accounts-changed', refreshCodex)
    }
  }, [isRemoteProject, localProjectPath])

  const prefetchSubscriptions = useCallback(() => {
    prefetchedRef.current = true
    if (isRemoteProject) {
      void loadNodeSubscriptions(false)
      return
    }
    for (const account of claudeAccounts) {
      void loadClaudeMeter(account.credentialDir, false, true)
    }
    for (const account of codexAccounts) {
      void loadCodexMeter(account.id, false, true, false)
    }
    window.app?.claudeListAccounts?.(false)
      .then((accounts) => {
        const signedIn = (accounts ?? []).filter((a) => a.loggedIn)
        cachedClaudeAccounts = signedIn
        setClaudeAccounts(signedIn)
        for (const account of signedIn) {
          const key = claudeHubKey(account.credentialDir)
          if (!claudeMeters[key]) {
            void loadClaudeMeter(account.credentialDir, false, true)
          }
        }
      })
      .catch(() => {})
    if (typeof window.app?.codexListAccounts === 'function') {
      window.app.codexListAccounts(localProjectPath ?? '', false)
        .then((accounts) => {
          const signedIn = (accounts ?? []).filter((a) => a.signedIn && !a.unavailable)
          cachedCodexAccounts = signedIn
          setCodexAccounts(signedIn)
          for (const account of signedIn) {
            const key = codexHubKey(codexAccountProviderId(account.id))
            if (!codexMeters[key]) {
              void loadCodexMeter(account.id, false, true, false)
            }
          }
        })
        .catch(() => {})
    }
    for (const agent of ACP_HUB_AGENTS) {
      void loadAcpMeter(agent.agentId, false)
    }
  }, [isRemoteProject, localProjectPath, claudeAccounts, codexAccounts, claudeMeters, codexMeters, loadClaudeMeter, loadCodexMeter, loadAcpMeter, loadNodeSubscriptions])

  const handleOpenList = useCallback(() => {
    setHasOpenedList(true)
    setView('list')
    if (!prefetchedRef.current) {
      prefetchSubscriptions()
    }
  }, [prefetchSubscriptions])

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

  // The node report does not include source timestamps; do not borrow the session's.
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
      if (!hasData) {
        return <EmptyUsageState />
      }
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
      if (!hasData) {
        return <EmptyUsageState />
      }
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
      if (!hasData) {
        return <EmptyUsageState />
      }
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
        {/* Wide enough that every gauge sits at the same width. Codex's labels ("5h") are far
            shorter than Claude's ("Fable weekly"), so a lower floor left the two popovers
            visibly different sizes depending on which harness the session ran. */}
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

          <PanelHeight open={view === 'list'}>
            {hasOpenedList && (
              <div className="flex flex-col gap-2.5 p-3">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                  <button
                    type="button"
                    onClick={() => setView('detail')}
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
                              onToggle={() => toggleGroup(harness)}
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
                                    onClick={() => { setSelectedAccountKey(key); setView('detail') }}
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
                        onToggle={() => toggleGroup('claude')}
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
                                  setSelectedAccountKey(null)
                                } else {
                                  setSelectedAccountKey(key)
                                  const fetched = meter?.limits?.fetchedAt
                                  if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS) {
                                    void loadClaudeMeter(account.credentialDir, false, false)
                                  }
                                }
                                setView('detail')
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
                        onToggle={() => toggleGroup('openai')}
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
                                  setSelectedAccountKey(null)
                                } else {
                                  setSelectedAccountKey(key)
                                  const fetched = meter?.limits?.fetchedAt
                                  if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS || meter?.usage === undefined) {
                                    void loadCodexMeter(account.id, false, false, true)
                                  }
                                }
                                setView('detail')
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
                          onToggle={() => toggleGroup(agent.key)}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (isCurrent) {
                                setSelectedAccountKey(null)
                              } else {
                                setSelectedAccountKey(agent.key)
                                const fetched = limits?.fetchedAt
                                if (fetched == null || Date.now() - fetched > FORCE_REFRESH_ON_OPEN_STALE_MS) {
                                  void loadAcpMeter(agent.agentId, false)
                                }
                              }
                              setView('detail')
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
                        onToggle={() => toggleGroup('current')}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAccountKey(null)
                            setView('detail')
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
        </div>
      </PopoverContent>
    </Popover>
  )
}

function useRefetchOnTurnEnd(status: string, fetchLimits: () => void) {
  const prevStatusRef = useRef(status)
  useEffect(() => {
    fetchLimits()
  }, [fetchLimits])
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'streaming' && status === 'idle') fetchLimits()
    // Runtime is definitely up once a turn starts — covers the prewarm race
    // where the first mount fetch ran before the agent answered billing.
    if (prev !== 'streaming' && status === 'streaming') fetchLimits()
  }, [status, fetchLimits])
  useEffect(() => {
    if (status !== 'streaming') return
    const timer = window.setInterval(fetchLimits, USAGE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [status, fetchLimits])
}

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
  const [limits, setLimits] = useState<ProviderRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLimits = useCallback(() => {
    window.app.providerGetRateLimits(apiProviderId).then(setLimits).catch(() => {})
  }, [apiProviderId])

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.app
      .providerGetRateLimits(apiProviderId, true)
      .then(setLimits)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [apiProviderId])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useEffect(() => {
    setLimits(null)
  }, [apiProviderId])

  useRefetchOnTurnEnd(status, fetchLimits)

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

/**
 * Grok Build credits, read from the live ACP runtime via `_x.ai/billing`.
 * Only Grok exposes a billing surface, so other ACP agents keep the bare tip.
 */
function AcpRateLimitIcon({ projectPath, agentId, status, tip, highlight }: { projectPath: string; agentId: string; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const [limits, setLimits] = useState<ProviderRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLimits = useCallback(() => {
    window.app.acpGetRateLimits(projectPath, agentId).then(setLimits).catch(() => {})
  }, [projectPath, agentId])

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.app
      .acpGetRateLimits(projectPath, agentId, true)
      .then(setLimits)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [projectPath, agentId])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useEffect(() => {
    setLimits(null)
  }, [projectPath, agentId])

  useRefetchOnTurnEnd(status, fetchLimits)

  // First paint often races prewarm: no runtime yet → null. Retry a couple of
  // times so a later runtime-ready prefetch (or a late first answer) shows up
  // without waiting for the turn to finish.
  useEffect(() => {
    if (limits) return
    const timers = ACP_BILLING_RETRY_MS.map((ms) => window.setTimeout(fetchLimits, ms))
    return () => { for (const id of timers) window.clearTimeout(id) }
  }, [limits, fetchLimits])

  const hasUsage = Boolean(limits && limits.windows.length > 0)
  const badgeWindow = limits?.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null
  const label = limits?.title ?? t('usageGauge.windowFallback')

  const titleNode = isGrokAcpAgent(agentId)
    ? <ProviderLabel brandKey="grok" size={14} />
    : isAntigravityAcpAgent(agentId)
      ? <ProviderLabel brandKey="antigravity" size={14} />
      : label

  const activeAccountKey = isGrokAcpAgent(agentId)
    ? 'acp:grok-build'
    : isAntigravityAcpAgent(agentId)
      ? 'acp:antigravity'
      : 'session:current'

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
    return <UntrackedRateLimitIcon providerId={activeProvider ?? null} acpAgentId={acpAgentId ?? null} tip={tip} highlight={highlight} />
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
    return <ProviderRateLimitIcon apiProviderId={apiProviderId} status={status} tip={tip} highlight={highlight} />
  }

  if (activeProvider === 'acp' && acpAgentId && (isGrokAcpAgent(acpAgentId) || isAntigravityAcpAgent(acpAgentId))) {
    return <AcpRateLimitIcon projectPath={activeProject} agentId={acpAgentId} status={status} tip={tip} highlight={highlight} />
  }

  return <UntrackedRateLimitIcon providerId={activeProvider ?? null} acpAgentId={acpAgentId ?? null} tip={tip} highlight={highlight} />
}
