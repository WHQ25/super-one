import { Plus, Copy, ExternalLink, Loader2, LogIn, LogOut, RefreshCw, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { cn } from '@superone/ui/lib/utils'
import type { CodexAccount, CodexManagedLoginStart } from '@superone/shared/codex-accounts'
import { SettingsCard, settingsRowClassName } from './settings/SettingsSection'
import { SettingsEmptyState } from './settings/SettingsEmptyState'

import { ProviderLabel } from './ProviderLabel'
import { CodexAccountMeters } from './CodexAccountMeters'

export interface CodexAccountsPanelProps {
  accounts: CodexAccount[]
  meters?: Record<string, CodexAccountMeters>
  loading?: boolean
  busy?: boolean
  disabled?: boolean
  error?: string | null
  pending?: CodexManagedLoginStart | null
  onRefresh: () => void
  onSignIn: (id?: string) => void
  onSignOut: (id: string) => void
  onSetDefault: (id: string) => void
  onCancel: () => void
  onOpenLogin: () => void
  onCopyCode: () => void
}

export function CodexAccountsPanel({ accounts, meters = {}, loading, busy, disabled, error, pending, onRefresh, onSignIn, onSignOut, onSetDefault, onCancel, onOpenLogin, onCopyCode }: CodexAccountsPanelProps) {
  const { t } = useTranslation()
  const blocked = !!(busy || disabled || pending)
  const rows = [...accounts, ...(pending && !accounts.some((a) => a.id === pending.accountId)
    ? [{ id: pending.accountId, signedIn: false, isDefault: false, authMode: null, requiresOpenaiAuth: true, email: null, planType: null, unavailable: false } satisfies CodexAccount] : [])]
  const loginPanel = pending ? <div className="flex flex-col gap-3" role="status">
        <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{t('settings.harnesses.codexAccount.signingIn')}</p>
        {pending.userCode && <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-background px-3 py-1.5 text-lg">{pending.userCode}</code>
          <Button variant="outline" size="sm" className="h-7" onClick={onCopyCode}><Copy data-icon="inline-start" />{t('settings.harnesses.codexAccount.copyCode')}</Button>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-7" onClick={onOpenLogin}><ExternalLink data-icon="inline-start" />{t('settings.harnesses.codexAccount.openPage')}</Button>
          <Button variant="outline" size="sm" className="h-7" onClick={onCancel}><X data-icon="inline-start" />{t('settings.harnesses.codexAccount.cancel')}</Button>
        </div>
      </div> : null
  return (
    <section aria-label={t('settings.harnesses.codexAccount.title')} className="flex min-w-0 flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <ProviderLabel brandKey="openai" combine size={24} />
          <p className="text-xs text-muted-foreground">{t('settings.harnesses.codexAccount.multiDescription')}</p>
        </div>
        <IconButton tooltip={t('settings.harnesses.codexAccount.refresh')} disabled={loading || busy || disabled} onClick={onRefresh}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </IconButton>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading && accounts.length === 0 ? <Skeleton className="h-16 w-full rounded-lg" /> : null}
      {!loading && !pending && accounts.length === 0 && <SettingsEmptyState title={t('settings.harnesses.codexAccount.empty')} />}
      {rows.length > 0 && <SettingsCard>
        <ul className="rounded-[inherit]">
          {rows.map((account) => (
            <li key={account.id} className={cn(settingsRowClassName, 'flex min-w-0 flex-col gap-3')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-sm break-all" title={account.email ?? account.id}>{account.email || t('settings.harnesses.codexAccount.pendingAccount')}</span>
                    {account.isDefault && <Badge variant="secondary">{t('settings.harnesses.codexAccount.defaultAccount')}</Badge>}
                  </div>
                  {(account.unavailable || (!account.signedIn && pending?.accountId !== account.id)) && <span className="text-xs text-muted-foreground">
                    {t(account.unavailable ? 'settings.harnesses.codexAccount.unavailable' : 'settings.harnesses.codexAccount.signedOut')}
                  </span>}
                </div>
                {account.signedIn && <span className="shrink-0 text-xs text-muted-foreground">
                  {account.planType || meters[account.id]?.limits?.planType || 'ChatGPT'}
                </span>}
              </div>
              {account.signedIn && !account.unavailable && <CodexAccountMeters {...meters[account.id]} />}
              {pending?.accountId === account.id && loginPanel}
              {pending?.accountId !== account.id && <div className="flex flex-wrap items-center justify-end gap-2">
                {account.signedIn ? <>
                  {!account.isDefault && <Button variant="outline" size="sm" className="h-7" disabled={blocked || account.unavailable} onClick={() => onSetDefault(account.id)}>
                    <Star data-icon="inline-start" />{t('settings.harnesses.codexAccount.setDefault')}
                  </Button>}
                  <Button variant="ghost" size="sm" className="h-7" disabled={blocked} onClick={() => onSignOut(account.id)}><LogOut data-icon="inline-start" />{t('settings.harnesses.codexAccount.signOut')}</Button>
                </> : <Button variant="outline" size="sm" className="h-7" disabled={blocked} onClick={() => onSignIn(account.id)}><LogIn data-icon="inline-start" />{t('settings.harnesses.codexAccount.signIn')}</Button>}
              </div>}
            </li>
          ))}
        </ul>
      </SettingsCard>}
      {!pending && <Button variant="outline" className="h-7 self-start" size="sm" disabled={blocked || loading} onClick={() => onSignIn()}>
        {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
        {t('settings.harnesses.codexAccount.addAccount')}
      </Button>}
    </section>
  )
}
