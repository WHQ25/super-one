import { Copy, ExternalLink, Loader2, LogIn, LogOut, RefreshCw, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import type { CodexAccount, CodexManagedLoginStart } from '@superone/shared/codex-accounts'

export interface CodexAccountsPanelProps {
  accounts: CodexAccount[]
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

export function CodexAccountsPanel({ accounts, loading, busy, disabled, error, pending, onRefresh, onSignIn, onSignOut, onSetDefault, onCancel, onOpenLogin, onCopyCode }: CodexAccountsPanelProps) {
  const { t } = useTranslation()
  const blocked = !!(busy || disabled || pending)
  return (
    <section aria-label={t('settings.harnesses.codexAccount.title')} className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-medium">{t('settings.harnesses.codexAccount.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.harnesses.codexAccount.multiDescription')}</p>
        </div>
        <IconButton tooltip={t('settings.harnesses.codexAccount.refresh')} disabled={loading || busy || disabled} onClick={onRefresh}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </IconButton>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading && accounts.length === 0 ? <Skeleton className="h-16 w-full" /> : null}
      {!loading && accounts.length === 0 && <p className="text-sm text-muted-foreground">{t('settings.harnesses.codexAccount.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {accounts.map((account) => (
          <li key={account.id} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all text-sm" title={account.email ?? account.id}>{account.email || t('settings.harnesses.codexAccount.pendingAccount')}</span>
                {account.isDefault && <Badge variant="secondary">{t('settings.harnesses.codexAccount.defaultAccount')}</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                {account.unavailable ? t('settings.harnesses.codexAccount.unavailable') : account.signedIn ? account.planType || 'ChatGPT' : t('settings.harnesses.codexAccount.signedOut')}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {account.signedIn ? <>
                {!account.isDefault && <Button variant="outline" size="sm" disabled={blocked || account.unavailable} onClick={() => onSetDefault(account.id)}>
                  <Star data-icon="inline-start" />{t('settings.harnesses.codexAccount.setDefault')}
                </Button>}
                <Button variant="ghost" size="sm" disabled={blocked} onClick={() => onSignOut(account.id)}><LogOut data-icon="inline-start" />{t('settings.harnesses.codexAccount.signOut')}</Button>
              </> : <Button variant="outline" size="sm" disabled={blocked} onClick={() => onSignIn(account.id)}><LogIn data-icon="inline-start" />{t('settings.harnesses.codexAccount.signIn')}</Button>}
            </div>
          </li>
        ))}
      </ul>
      {pending ? <div className="flex flex-col gap-3" role="status">
        <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{t('settings.harnesses.codexAccount.signingIn')}</p>
        {pending.userCode && <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-3 py-2 text-lg">{pending.userCode}</code>
          <Button variant="outline" size="sm" onClick={onCopyCode}><Copy data-icon="inline-start" />{t('settings.harnesses.codexAccount.copyCode')}</Button>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onOpenLogin}><ExternalLink data-icon="inline-start" />{t('settings.harnesses.codexAccount.openPage')}</Button>
          <Button variant="outline" size="sm" onClick={onCancel}><X data-icon="inline-start" />{t('settings.harnesses.codexAccount.cancel')}</Button>
        </div>
      </div> : <Button className="self-start" size="sm" disabled={blocked || loading} onClick={() => onSignIn()}>
        {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
        {t('settings.harnesses.codexAccount.addAccount')}
      </Button>}
    </section>
  )
}
