import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, LogOut, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { toast } from 'sonner'
import { useChatStore } from '@/stores/chat'
import type { ClaudeAccount, ClaudeRateLimits, CodexAccountStatus, CodexAccountUsage, CodexAuthStatus, CodexRateLimits } from '@superone/shared/agent-types'
import { ProviderLabel } from './ProviderLabel'

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatWindowLabel(minutes: number | null, t: TFunction): string {
  if (!minutes || minutes <= 0) return t('usageGauge.windowFallback')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function formatResetIn(resetsAtSeconds: number | null, t: TFunction): string | null {
  if (!resetsAtSeconds) return null
  const diffMs = resetsAtSeconds * 1000 - Date.now()
  if (diffMs <= 0) return t('usageGauge.resetsSoon')
  const totalMin = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const time = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return t('usageGauge.resetsIn', { time })
}

function remainingColor(percent: number): string {
  if (percent <= 10) return 'bg-red-500'
  if (percent <= 30) return 'bg-amber-500'
  return 'bg-green-500'
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium tabular-nums">{value}</span>
    </div>
  )
}

function WindowBar({ label, usedPercent, resetsAt }: { label: string; usedPercent: number; resetsAt: number | null }) {
  const { t } = useTranslation()
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetIn = formatResetIn(resetsAt, t)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="opacity-70">{label}</span>
        <span className="flex items-center gap-1.5">
          {resetIn && <span className="opacity-50">{resetIn} ·</span>}
          <span className="font-medium tabular-nums">{t('usageGauge.percentLeft', { percent: Math.round(remaining) })}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className={cn('h-full rounded-full transition-all', remainingColor(remaining))} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  )
}

function PanelShell({ brandKey, children, onRefresh, refreshing }: { brandKey: string; children: ReactNode; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ProviderLabel brandKey={brandKey} combine size={30} />
        <IconButton size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </IconButton>
      </div>
      {children}
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-md border border-border p-3">{children}</div>
}

interface AccountUsage {
  account: ClaudeAccount
  limits: ClaudeRateLimits | null
}

/**
 * The settings panel is the one place that reads every account's meters. The chat popover
 * deliberately reads only the session's own account: a per-account fetch costs one usage request
 * each, and that endpoint throttles hard (5-minute floor, 429 backoff).
 */
function ClaudeAccountsPanel() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<AccountUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [busyDir, setBusyDir] = useState<string | null>(null)

  const fetchAll = useCallback((force?: boolean) => {
    setLoading(true)
    window.app
      .claudeListAccounts()
      .then(async (accounts) => {
        const next = await Promise.all(
          accounts.map(async (account) => ({
            account,
            limits: account.loggedIn
              ? await window.app.claudeGetRateLimits(force, account.credentialDir).catch(() => null)
              : null,
          })),
        )
        setRows(next)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const signIn = useCallback(async () => {
    setSigningIn(true)
    try {
      const added = await window.app.claudeSignInAccount()
      if (added?.loggedIn) toast.success(t('resources.providers.claudeAccountAdded', { email: added.email ?? '' }))
      else toast.error(t('resources.providers.claudeAccountAddFailed'))
      fetchAll(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSigningIn(false)
    }
  }, [fetchAll, t])

  const signOut = useCallback(async (credentialDir: string) => {
    setBusyDir(credentialDir)
    try {
      await window.app.claudeSignOutAccount(credentialDir)
      fetchAll(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyDir(null)
    }
  }, [fetchAll])

  return (
    <PanelShell brandKey="claude" onRefresh={() => fetchAll(true)} refreshing={loading}>
      {rows.map(({ account, limits }) => (
        <ClaudeAccountRow
          key={account.credentialDir ?? '__default__'}
          account={account}
          limits={limits}
          busy={busyDir === account.credentialDir}
          onSignOut={account.credentialDir ? () => void signOut(account.credentialDir as string) : undefined}
        />
      ))}
      {rows.length === 0 && (
        <Section>
          <span className="text-sm text-muted-foreground">
            {loading ? t('resources.providers.accountLoading') : t('resources.providers.accountNotSignedIn')}
          </span>
        </Section>
      )}
      <Button variant="outline" size="sm" className="self-start" disabled={signingIn} onClick={() => void signIn()}>
        {signingIn ? <Loader2 data-icon className="animate-spin" /> : <Plus data-icon />}
        {t('resources.providers.claudeAddAccount')}
      </Button>
    </PanelShell>
  )
}

function ClaudeAccountRow({ account, limits, busy, onSignOut }: {
  account: ClaudeAccount
  limits: ClaudeRateLimits | null
  busy: boolean
  onSignOut?: () => void
}) {
  const { t } = useTranslation()
  const plan = account.subscriptionType || limits?.planType

  return (
    <Section>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {account.email ?? t('resources.providers.accountNotSignedIn')}
          </span>
          {account.orgName && <span className="truncate text-xs text-muted-foreground">{account.orgName}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {plan && <span className="text-xs text-muted-foreground">{plan}</span>}
          {/* The default domain is the CLI's own login: signing it out here would also sign the
              user out of `claude` in their terminal, so only managed domains get the control. */}
          {onSignOut && (
            <IconButton size="sm" variant="ghost" disabled={busy} tooltip={t('resources.providers.claudeSignOutAccount')} onClick={onSignOut}>
              {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
            </IconButton>
          )}
        </div>
      </div>
      {limits && limits.windows.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          {limits.windows.map((w) => (
            <WindowBar key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
          ))}
          {limits.extraUsage && (
            <InfoRow
              label={t('usageGauge.extraUsage')}
              value={limits.extraUsage.limitDollars != null ? `$${limits.extraUsage.usedDollars.toFixed(2)} / $${limits.extraUsage.limitDollars.toFixed(2)}` : `$${limits.extraUsage.usedDollars.toFixed(2)}`}
            />
          )}
        </div>
      )}
    </Section>
  )
}

function CodexAccount() {
  const { t } = useTranslation()
  const projectPath = useChatStore((s) => s.activeProject)
  const [account, setAccount] = useState<CodexAccountStatus | null>(null)
  const [auth, setAuth] = useState<CodexAuthStatus | null>(null)
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const [usage, setUsage] = useState<CodexAccountUsage | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(() => {
    if (!projectPath) return
    setLoading(true)
    Promise.allSettled([
      window.app.codexGetAccountStatus(projectPath).then(setAccount),
      window.app.codexGetAuthStatus(projectPath).then(setAuth),
      window.app.codexGetRateLimits(projectPath, null).then(setLimits),
      window.app.codexGetAccountUsage(projectPath, null).then(setUsage),
    ]).finally(() => setLoading(false))
  }, [projectPath])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (!projectPath) {
    return (
      <PanelShell brandKey="openai" onRefresh={fetchAll} refreshing={false}>
        <span className="text-sm text-muted-foreground">{t('resources.providers.codexNeedsProject')}</span>
      </PanelShell>
    )
  }

  return (
    <PanelShell brandKey="openai" onRefresh={fetchAll} refreshing={loading}>
      <Section>
        {account?.signedIn ? <InfoRow label={t('resources.providers.accountSignIn')} value={account.authMode === 'chatgpt' ? 'ChatGPT' : (account.authMode ?? 'Codex')} /> : null}
        {!account?.signedIn && auth?.resolvedMode === 'apiKey' && (auth.hasEnvApiKey || auth.hasSessionApiKey) ? (
          <InfoRow label={t('resources.providers.accountSignIn')} value="API Key" />
        ) : null}
        {account?.email ? <InfoRow label={t('resources.providers.accountEmail')} value={account.email} /> : null}
        {(account?.planType || limits?.planType) ? <InfoRow label={t('resources.providers.accountPlan')} value={account?.planType || limits?.planType} /> : null}
        {!account?.signedIn && !(auth?.resolvedMode === 'apiKey' && (auth.hasEnvApiKey || auth.hasSessionApiKey)) && (
          <span className="text-sm text-muted-foreground">{loading ? t('resources.providers.accountLoading') : t('resources.providers.accountNotSignedIn')}</span>
        )}
      </Section>
      {limits && (limits.primary || limits.secondary) && (
        <Section>
          {limits.primary && <WindowBar label={formatWindowLabel(limits.primary.windowDurationMins, t)} usedPercent={limits.primary.usedPercent} resetsAt={limits.primary.resetsAt} />}
          {limits.secondary && <WindowBar label={formatWindowLabel(limits.secondary.windowDurationMins, t)} usedPercent={limits.secondary.usedPercent} resetsAt={limits.secondary.resetsAt} />}
        </Section>
      )}
      {usage && (usage.lifetimeTokens != null || usage.peakDailyTokens != null || usage.currentStreakDays != null) && (
        <Section>
          {usage.lifetimeTokens != null && <InfoRow label={t('usageGauge.lifetimeTokens')} value={formatTokens(usage.lifetimeTokens)} />}
          {usage.peakDailyTokens != null && <InfoRow label={t('usageGauge.peakDaily')} value={formatTokens(usage.peakDailyTokens)} />}
          {usage.currentStreakDays != null && <InfoRow label={t('usageGauge.streak')} value={`${usage.currentStreakDays}d`} />}
        </Section>
      )}
      {loading && !account && !limits && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {t('resources.providers.accountLoading')}</div>
      )}
    </PanelShell>
  )
}

export function OfficialProviderPanel({ harness }: { harness: 'claude' | 'codex' }) {
  return harness === 'claude' ? <ClaudeAccountsPanel /> : <CodexAccount />
}
