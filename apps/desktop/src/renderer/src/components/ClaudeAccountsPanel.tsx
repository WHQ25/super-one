import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, LogIn, LogOut, Star, RefreshCw, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClaudeAccount, ClaudeRateLimits } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { SettingsEmptyState } from './settings/SettingsEmptyState'
import { ProviderLabel } from './ProviderLabel'
import { ProviderAccountCard, ProviderAccountHeader } from './ProviderAccountHeader'
import { InfoRow, WindowBar } from './provider-usage'
import { claudeAccountsChanged } from '@/hooks/useClaudeAccounts'
import { AccountUsageRefreshButton } from './AccountUsageRefreshButton'
import { useProviderAccountMeters } from './use-provider-account-meters'

type Meter = { loading?: boolean; limits?: ClaudeRateLimits | null; error?: boolean }
export interface ClaudeAccountsPanelProps {
  accounts: ClaudeAccount[]; meters?: Record<string, Meter>; loading?: boolean; busy?: boolean; signingIn?: boolean; error?: string | null
  onRefresh: () => void; onRefreshUsage: (dir: string | null) => void; onSignIn: (dir?: string) => void; onSignOut: (dir: string) => void
  onSetDefault: (dir: string | null) => void; onCancel: () => void
}
const key = (dir: string | null) => dir ?? '__cli__'
export function ClaudeAccountsPanel({ accounts, meters = {}, loading, busy, signingIn, error, onRefresh, onRefreshUsage, onSignIn, onSignOut, onSetDefault, onCancel }: ClaudeAccountsPanelProps) {
  const { t } = useTranslation()
  return <section aria-label={t('resources.providers.claudeAccountsTitle')} className="flex min-w-0 flex-col gap-3">
    <header className="flex items-start justify-between gap-3">
      <ProviderLabel brandKey="claude" combine size={24} />
      <IconButton tooltip={t('settings.harnesses.codexAccount.refresh')} disabled={loading || busy} onClick={onRefresh}><RefreshCw className={loading ? 'animate-spin' : undefined} /></IconButton>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading && !accounts.length && <Skeleton className="h-16 w-full rounded-lg" />}
    {!loading && !accounts.length && <SettingsEmptyState title={t('resources.providers.accountNotSignedIn')} />}
    {accounts.length > 0 && <ul className="flex flex-col gap-2">{accounts.map((account) => {
      const meter = meters[key(account.credentialDir)]
      return <ProviderAccountCard key={key(account.credentialDir)}>
        <ProviderAccountHeader email={account.email || t('resources.providers.claudePendingAccount')} detail={account.orgName}
          plan={account.loggedIn ? account.subscriptionType || meter?.limits?.planType : null}
          isDefault={account.isDefault} defaultLabel={t('settings.harnesses.codexAccount.defaultAccount')}
          state={!account.loggedIn ? t('settings.harnesses.codexAccount.signedOut') : account.identityStatus === 'unavailable' ? t('resources.providers.claudeIdentityUnavailable') : null} />
        {account.loggedIn && <div className="flex flex-col gap-2">
          {meter?.loading && !meter.limits && <Skeleton className="h-10 w-full" />}
          {meter?.error && <span className="text-xs text-muted-foreground">{t('resources.providers.claudeUsageUnavailable')}</span>}
          {meter?.limits?.windows.map((window) => <WindowBar key={window.id ?? window.label} {...window} />)}
          {meter?.limits?.extraUsage && <InfoRow label={t('usageGauge.extraUsage')} value={meter.limits.extraUsage.limitDollars != null
            ? `$${meter.limits.extraUsage.usedDollars.toFixed(2)} / $${meter.limits.extraUsage.limitDollars.toFixed(2)}` : `$${meter.limits.extraUsage.usedDollars.toFixed(2)}`} />}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          {account.credentialDir && (account.loggedIn
            ? <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => onSignOut(account.credentialDir!)}><LogOut data-icon="inline-start" />{t('settings.harnesses.codexAccount.signOut')}</Button>
            : <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => onSignIn(account.credentialDir!)}><LogIn data-icon="inline-start" />{t('common.signInAgain')}</Button>)}
          {account.loggedIn && !account.isDefault && <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => onSetDefault(account.credentialDir)}><Star data-icon="inline-start" />{t('settings.harnesses.codexAccount.setDefault')}</Button>}
          {account.loggedIn && <AccountUsageRefreshButton loading={meter?.loading} disabled={busy} onClick={() => onRefreshUsage(account.credentialDir)} />}
        </div>
      </ProviderAccountCard>
    })}</ul>}
    {signingIn ? <div className="flex items-center gap-2" role="status"><Loader2 className="size-4 animate-spin" /><span className="text-sm">{t('resources.providers.claudeSigningIn')}</span><Button variant="ghost" size="sm" onClick={onCancel}><X data-icon="inline-start" />{t('settings.harnesses.codexAccount.cancel')}</Button></div>
      : <Button variant="ghost" size="sm" className="h-7 self-start" disabled={busy || loading} onClick={() => onSignIn()}><Plus data-icon="inline-start" />{t('resources.providers.claudeAddAccount')}</Button>}
  </section>
}

export function ClaudeAuthSettings() {
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([])
  const { meters, sync: syncMeters, load: loadMeter } = useProviderAccountMeters<Meter>()
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0), mounted = useRef(true)
  const refreshUsage = useCallback((dir: string | null, force = false) => loadMeter(key(dir), async () => {
    const limits = await window.app.claudeGetRateLimits(force, dir, !force)
    return { ...(limits ? { limits } : {}), error: !limits }
  }), [loadMeter])
  const refresh = useCallback(async (force = false) => {
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await window.app.claudeListAccounts(force)
      if (!mounted.current || request !== generation.current) return
      setAccounts(result); setError(null)
      const signedIn = result.filter((a) => a.loggedIn)
      syncMeters(signedIn.map((a) => ({ key: key(a.credentialDir), identity: a.identityKey ?? JSON.stringify([a.email, a.orgId, a.identityStatus]) })))
      for (const account of signedIn) void refreshUsage(account.credentialDir)
    } catch (error) { if (mounted.current && request === generation.current) setError(String(error instanceof Error ? error.message : error)) }
    finally { if (mounted.current && request === generation.current) setLoading(false) }
  }, [syncMeters, refreshUsage])
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; generation.current++ } }, [refresh])
  const action = async (run: () => Promise<unknown>, signIn = false) => {
    if (busy) return
    setBusy(true); setSigningIn(signIn); setError(null)
    try { await run(); claudeAccountsChanged(); if (mounted.current) await refresh(true) }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) { setBusy(false); setSigningIn(false) } }
  }
  return <ClaudeAccountsPanel accounts={accounts} meters={meters} loading={loading} busy={busy} signingIn={signingIn} error={error}
    onRefreshUsage={(dir) => { void refreshUsage(dir, true) }}
    onRefresh={() => void refresh(true)} onSignIn={(dir) => { void action(() => window.app.claudeSignInAccount(undefined, dir), true) }}
    onSignOut={(dir) => { void action(() => window.app.claudeSignOutAccount(dir)) }} onSetDefault={(dir) => { void action(() => window.app.claudeSetDefaultAccount(dir)) }}
    onCancel={() => { void window.app.claudeCancelSignIn().catch((error) => setError(String(error))) }} />
}
