import { CodexAuthSettings } from './CodexAuthSettings'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, LogOut, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { toast } from 'sonner'
import type { ClaudeAccount, ClaudeRateLimits } from '@superone/shared/agent-types'
import { InfoRow, WindowBar } from './provider-usage'
import { ProviderLabel } from './ProviderLabel'

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
      .claudeListAccounts(force)
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


export function OfficialProviderPanel({ harness }: { harness: 'claude' | 'codex' }) {
  return harness === 'claude' ? <ClaudeAccountsPanel /> : <CodexAuthSettings />
}
