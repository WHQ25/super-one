import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn, LogOut, Plus, RefreshCw, Settings2, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@superone/ui/components/ui/alert'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import type {
  AntigravityAccountsSnapshot,
  AntigravityAccountSummary,
  AntigravityAuthMethod,
  AntigravityAuthRequest,
} from '@superone/shared/antigravity-auth'
import { requestOpenExternalLink } from '@/lib/external-link'
import { AntigravityAccountForm, type AntigravityAccountFormValues } from './AntigravityAccountForm'
import { AntigravityLoginPanel } from './AntigravityLoginPanel'
import { ProviderAccountCard, ProviderAccountHeader } from './ProviderAccountHeader'

export type AntigravityAuthApi = (
  request: AntigravityAuthRequest,
) => Promise<AntigravityAccountsSnapshot>

const defaultApi: AntigravityAuthApi = (request) => window.app.antigravityAuth(request)

const METHOD_LABEL_KEYS: Record<AntigravityAuthMethod, string> = {
  'oauth-personal': 'antigravityAuth.methods.oauthPersonal',
  'oauth-business': 'antigravityAuth.methods.oauthBusiness',
  'gemini-api-key': 'antigravityAuth.methods.geminiApiKey',
  'agent-platform': 'antigravityAuth.methods.agentPlatform',
}

function isOAuthMethod(method: AntigravityAuthMethod): boolean {
  return method === 'oauth-personal' || method === 'oauth-business'
}

export function AntigravityAuthSettings({
  api = defaultApi,
  onAuthChanged,
}: {
  api?: AntigravityAuthApi
  onAuthChanged?: () => void
}) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<AntigravityAccountsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const mounted = useRef(false)
  const snapshotRef = useRef(snapshot)
  const revision = useRef(0)
  const changed = useRef(onAuthChanged)
  changed.current = onAuthChanged

  const notifyChanged = useCallback(() => {
    window.dispatchEvent(new Event('antigravity-accounts-changed'))
    changed.current?.()
  }, [])

  const apply = useCallback(
    (next: AntigravityAccountsSnapshot, forceNotify = false) => {
      if (!mounted.current) return
      const prev = snapshotRef.current
      const loginFinished = Boolean(prev?.activeLogin && !next.activeLogin && !next.error)
      snapshotRef.current = next
      setSnapshot(next)
      if (forceNotify || loginFinished) notifyChanged()
    },
    [notifyChanged],
  )

  const request = useCallback(
    async (action: AntigravityAuthRequest, notifyOnSuccess = false) => {
      const current = ++revision.current
      setBusy(true)
      setError('')
      try {
        const next = await api(action)
        if (!mounted.current) {
          if (action.action === 'startLogin' && next.activeLogin?.loginId) {
            void api({ action: 'cancelLogin', loginId: next.activeLogin.loginId }).catch(() => {})
          }
          return next
        }
        if (current === revision.current) apply(next, notifyOnSuccess)
        return next
      } catch (cause) {
        if (mounted.current && current === revision.current) {
          setError(cause instanceof Error ? cause.message : t('antigravityAuth.unknownError'))
        }
        return null
      } finally {
        if (mounted.current && current === revision.current) setBusy(false)
      }
    },
    [api, apply, t],
  )

  useEffect(() => {
    mounted.current = true
    void request({ action: 'refresh' })
    return () => {
      mounted.current = false
      ++revision.current
      const activeId = snapshotRef.current?.activeLogin?.loginId
      if (activeId) {
        void api({ action: 'cancelLogin', loginId: activeId }).catch(() => {})
      }
    }
  }, [api, request])

  const activeLogin = snapshot?.activeLogin ?? null
  useEffect(() => {
    if (!activeLogin) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const current = revision.current
      try {
        const next = await api({ action: 'list' })
        if (!stopped && current === revision.current) apply(next)
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : t('antigravityAuth.unknownError'))
        }
      }
      if (!stopped) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [api, apply, activeLogin?.loginId, activeLogin?.status, t])

  const openBrowser = async (url: string) => {
    try {
      await requestOpenExternalLink(url)
    } catch {
      setError(t('antigravityAuth.browserError'))
    }
  }

  const handleCreate = async (values: AntigravityAccountFormValues) => {
    const next = await request(
      {
        action: 'create',
        ...(values.label ? { label: values.label } : {}),
        authMethod: values.authMethod,
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        ...(values.authMethod === 'oauth-business' || values.authMethod === 'agent-platform'
          ? { gcpProject: values.gcpProject, gcpLocation: values.gcpLocation }
          : {}),
      },
      true,
    )
    if (!next) return
    setAdding(false)
    const created = next.accounts[next.accounts.length - 1]
    if (
      created &&
      next.runtimeAvailable &&
      (created.authMethod === 'oauth-personal' ||
        (created.authMethod === 'oauth-business' && created.gcpProject && created.gcpLocation))
    ) {
      await request({ action: 'startLogin', accountId: created.id, authMethod: created.authMethod })
      return
    }
    toast.success(t('antigravityAuth.configSaved'))
  }

  const handleConfigure = async (accountId: string, values: AntigravityAccountFormValues) => {
    const next = await request(
      {
        action: 'configure',
        accountId,
        label: values.label,
        authMethod: values.authMethod,
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        ...(values.authMethod === 'oauth-business' || values.authMethod === 'agent-platform'
          ? { gcpProject: values.gcpProject, gcpLocation: values.gcpLocation }
          : {}),
      },
      true,
    )
    if (!next) return
    setEditingId(null)
    toast.success(t('antigravityAuth.configSaved'))
  }

  const accountTitle = (account: AntigravityAccountSummary): string => {
    if (account.label) return account.label
    if (account.isCliDefault) return account.email || t('antigravityAuth.cliAccountLabel')
    return account.email || account.id.slice(0, 8)
  }

  const accountPlanLabel = (account: AntigravityAccountSummary): string => {
    const methodLabel = t(METHOD_LABEL_KEYS[account.authMethod])
    if (account.label && account.email) return `${account.email} · ${methodLabel}`
    if (account.isCliDefault && !account.label && account.email) {
      return `${t('antigravityAuth.cliAccountLabel')} · ${methodLabel}`
    }
    return methodLabel
  }

  const blocked = busy || Boolean(activeLogin)
  const accounts = snapshot?.accounts ?? []
  const displayError = error || snapshot?.error

  return (
    <section className="flex w-full flex-col gap-3" aria-label={t('antigravityAuth.title')}>
      <header className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('antigravityAuth.multiDescription')}</p>
        <IconButton
          tooltip={t('antigravityAuth.refresh')}
          disabled={blocked}
          onClick={() => void request({ action: 'refresh' })}
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </IconButton>
      </header>

      {displayError && (
        <Alert variant="destructive">
          <AlertTitle>{t('antigravityAuth.failed')}</AlertTitle>
          <AlertDescription className="break-words">{displayError}</AlertDescription>
        </Alert>
      )}

      {!snapshot ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => {
            const isSigningIn = activeLogin?.accountId === account.id
            const isEditing = editingId === account.id
            const oauth = isOAuthMethod(account.authMethod)
            const stateLabel = isSigningIn
              ? t(
                  activeLogin.status === 'starting'
                    ? 'antigravityAuth.starting'
                    : activeLogin.status === 'verifying'
                      ? 'antigravityAuth.verifying'
                      : 'antigravityAuth.waiting',
                )
              : !account.signedIn
                ? t('antigravityAuth.signedOut')
                : null

            return (
              <ProviderAccountCard key={account.id}>
                <ProviderAccountHeader
                  email={accountTitle(account)}
                  isDefault={account.isDefault}
                  defaultLabel={t('antigravityAuth.defaultAccount')}
                  plan={accountPlanLabel(account)}
                  state={stateLabel}
                />

                {isSigningIn && activeLogin && (
                  <AntigravityLoginPanel
                    key={activeLogin.loginId}
                    activeLogin={activeLogin}
                    busy={busy}
                    onOpenBrowser={(url) => void openBrowser(url)}
                    onCancel={() =>
                      void request({ action: 'cancelLogin', loginId: activeLogin.loginId })
                    }
                    onSubmitResponse={(response) =>
                      void request({
                        action: 'submitLoginResponse',
                        loginId: activeLogin.loginId,
                        response,
                      })
                    }
                  />
                )}

                {isEditing && !isSigningIn && (
                  <AntigravityAccountForm
                    initialLabel={account.label ?? ''}
                    initialAuthMethod={account.authMethod}
                    initialGcpProject={account.gcpProject ?? ''}
                    initialGcpLocation={account.gcpLocation ?? 'us-central1'}
                    hasApiKey={account.hasApiKey}
                    disabled={blocked}
                    submitLabel={t('antigravityAuth.saveConfig')}
                    onClearApiKey={() =>
                      void request(
                        {
                          action: 'configure',
                          accountId: account.id,
                          authMethod: account.authMethod,
                          clearApiKey: true,
                        },
                        true,
                      )
                    }
                    onSubmit={(values) => handleConfigure(account.id, values)}
                    onCancel={() => setEditingId(null)}
                  />
                )}

                {!isSigningIn && !isEditing && (
                  <div className="flex flex-wrap items-center gap-2">
                    {oauth && !account.signedIn && snapshot.runtimeAvailable && (
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={blocked}
                        onClick={() =>
                          void request({
                            action: 'startLogin',
                            accountId: account.id,
                            authMethod: account.authMethod,
                          })
                        }
                      >
                        <LogIn data-icon="inline-start" />
                        {t('antigravityAuth.signIn')}
                      </Button>
                    )}
                    {oauth && account.signedIn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={blocked}
                        onClick={() =>
                          void request({ action: 'logout', accountId: account.id }, true)
                        }
                      >
                        <LogOut data-icon="inline-start" />
                        {t('antigravityAuth.signOut')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      disabled={blocked}
                      onClick={() => {
                        setAdding(false)
                        setEditingId(account.id)
                      }}
                    >
                      <Settings2 data-icon="inline-start" />
                      {t('antigravityAuth.configureAccount')}
                    </Button>
                    {!account.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={blocked}
                        onClick={() =>
                          void request({ action: 'setDefault', accountId: account.id }, true)
                        }
                      >
                        <Star data-icon="inline-start" />
                        {t('antigravityAuth.setDefault')}
                      </Button>
                    )}
                    {!account.isCliDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={blocked}
                        onClick={() =>
                          void request({ action: 'remove', accountId: account.id }, true)
                        }
                      >
                        <Trash2 data-icon="inline-start" />
                        {t('antigravityAuth.removeAccount')}
                      </Button>
                    )}
                  </div>
                )}
              </ProviderAccountCard>
            )
          })}
        </ul>
      )}

      {adding && !activeLogin && (
        <AntigravityAccountForm
          disabled={blocked}
          submitLabel={t('antigravityAuth.createAccount')}
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && !activeLogin && snapshot && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start"
          disabled={blocked}
          onClick={() => {
            setEditingId(null)
            setAdding(true)
          }}
        >
          <Plus data-icon="inline-start" />
          {t('antigravityAuth.addAccount')}
        </Button>
      )}
    </section>
  )
}
