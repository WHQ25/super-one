import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronDown } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { claudeAccountCredentialDir } from '@superone/shared/agent-types'
import type {
  ClaudeRateLimits,
  CodexAccountUsage,
  CodexRateLimits,
  CodexRateLimitResetCredit,
  CodexRateLimitResetOutcome,
  ProviderRateLimits,
} from '@superone/shared/agent-types'

export interface ClaudeMeterState {
  loading?: boolean
  limits?: ClaudeRateLimits | null
}

export interface CodexMeterState {
  loading?: boolean
  limits?: CodexRateLimits | null
  usage?: CodexAccountUsage | null
}

export interface ProviderMeterState {
  loading?: boolean
  limits?: ProviderRateLimits | null
}
import type { SubscriptionHarness, SubscriptionUsage } from '@superone/shared/environment'
import { usageWindowTone, type UsageWindow } from '@superone/shared/subscription-usage'
import { codexRowMatchesOmittedAccount } from '@/harness-ui/codex/node-account'
import { formatCreditExpiry, formatTokens } from '../provider-usage'
import { remainingPercent } from './rate-limit-tip'

const TAB_PANEL_SPRING = { type: 'spring', bounce: 0.15, duration: 0.3 } as const
const TONE_BAR_CLASS = { success: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500' } as const

const RESET_OUTCOME_TOAST: Record<CodexRateLimitResetOutcome, { kind: 'success' | 'info' | 'error'; key: string }> = {
  reset: { kind: 'success', key: 'usageGauge.toast.reset' },
  nothingToReset: { kind: 'info', key: 'usageGauge.toast.nothingToReset' },
  noCredit: { kind: 'info', key: 'usageGauge.toast.noCredit' },
  alreadyRedeemed: { kind: 'info', key: 'usageGauge.toast.alreadyRedeemed' },
  unknown: { kind: 'error', key: 'usageGauge.toast.unknown' },
}

export const UNTRACKED_PROVIDER_BRAND: Record<string, { brandKey?: string; title: string }> = {
  claude: { brandKey: 'claude', title: 'Claude' },
  codex: { brandKey: 'openai', title: 'Codex' },
  cursor: { brandKey: 'cursor', title: 'Cursor' },
  opencode: { title: 'OpenCode' },
  dsh: { title: 'DSH' },
  'acp-grok': { brandKey: 'grok', title: 'Grok Build' },
  'acp-antigravity': { brandKey: 'antigravity', title: 'Antigravity' },
}

export const ACP_HUB_AGENTS = [
  { agentId: 'grok-build', key: 'acp:grok-build', brandKey: 'grok', fallbackTitle: 'Grok Build' },
  { agentId: 'antigravity', key: 'acp:antigravity', brandKey: 'antigravity', fallbackTitle: 'Antigravity' },
] as const

export const SUBSCRIPTION_BRANDS: Record<SubscriptionHarness, { brandKey?: string; title: string }> = {
  claude: { brandKey: 'claude', title: 'Claude' },
  codex: { brandKey: 'openai', title: 'Codex' },
  grok: { brandKey: 'grok', title: 'Grok' },
  cursor: { brandKey: 'cursor', title: 'Cursor' },
  opencode: { title: 'OpenCode' },
}

export function claudeHubKey(credentialDir: string | null | undefined): string {
  return `claude:${credentialDir ?? '__default__'}`
}

export function codexHubKey(apiProviderId: string | null | undefined): string {
  return `codex:${apiProviderId ?? '__default__'}`
}

const SUBSCRIPTION_HUB_KEY: Record<SubscriptionHarness, (row: SubscriptionUsage) => string> = {
  claude: (row) => claudeHubKey(claudeAccountCredentialDir(row.apiProviderId)),
  codex: (row) => codexHubKey(row.apiProviderId),
  grok: () => 'acp:grok-build',
  cursor: (row) => row.harness,
  opencode: (row) => row.harness,
}

export function subscriptionHubKey(row: SubscriptionUsage): string {
  return SUBSCRIPTION_HUB_KEY[row.harness](row)
}

export function nodeRowIsCurrentSession(
  row: SubscriptionUsage,
  activeAccountKey: string,
  accounts: readonly SubscriptionUsage[],
): boolean {
  if (subscriptionHubKey(row) === activeAccountKey) return true
  return codexRowMatchesOmittedAccount(row, accounts, activeAccountKey === codexHubKey(null))
}

export function formatUpdatedAgo(fetchedAt: number, now: number, t: TFunction): string {
  const min = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (min < 1) return t('usageGauge.updatedJustNow')
  if (min < 60) return t('usageGauge.updatedMinutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('usageGauge.updatedHoursAgo', { n: hr })
  return t('usageGauge.updatedDaysAgo', { n: Math.floor(hr / 24) })
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function CreditBalanceRow({ dollars }: { dollars: number }) {
  const { t } = useTranslation()
  return <StatRow label={t('usageGauge.creditBalance')} value={`$${dollars.toFixed(2)}`} />
}

export function ResetCreditsRow({
  count,
  credits,
  projectPath,
  apiProviderId,
  onConsumed,
}: {
  count: number
  credits?: CodexRateLimitResetCredit[]
  projectPath: string
  apiProviderId: string | null
  onConsumed: () => void
}) {
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

export function AccountUsageSection({ usage }: { usage: CodexAccountUsage }) {
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

export function PanelHeight({ open, children }: { open: boolean; children: ReactNode }) {
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

export function AccountCardWindows({ windows, loading }: { windows: UsageWindow[]; loading?: boolean }) {
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

export function EmptyUsageState() {
  const { t } = useTranslation()
  return (
    <div className="rounded-md bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
      {t('usageGauge.noUsageInfo')}
    </div>
  )
}

export function SubscriptionGroup({
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
