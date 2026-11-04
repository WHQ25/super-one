import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@superone/ui/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import type {
  AntigravityAuthMethod,
  AntigravityAuthRequest,
  AntigravityAuthState,
} from '@superone/shared/antigravity-auth'
import { cn } from '@superone/ui/lib/utils'
import { requestOpenExternalLink } from '@/lib/external-link'
import { SettingsCard, SettingsRow, settingsRowClassName } from '@/components/settings/SettingsSection'

export type AntigravityAuthApi = (request: AntigravityAuthRequest) => Promise<AntigravityAuthState>
const defaultApi: AntigravityAuthApi = (request) => window.app.antigravityAuth(request)
const pending = (state: AntigravityAuthState | null) =>
  !!state && ['starting', 'waiting', 'verifying'].includes(state.status)

const AUTH_METHOD_LABEL_KEYS: Record<AntigravityAuthMethod, string> = {
  'oauth-personal': 'antigravityAuth.methods.oauthPersonal',
  'oauth-business': 'antigravityAuth.methods.oauthBusiness',
  'gemini-api-key': 'antigravityAuth.methods.geminiApiKey',
  'agent-platform': 'antigravityAuth.methods.agentPlatform',
}

export function AntigravityAuthSettings({
  api = defaultApi,
  onAuthChanged,
}: {
  api?: AntigravityAuthApi
  onAuthChanged?: () => void
}) {
  const { t } = useTranslation()
  const callbackId = useId()
  const apiKeyId = useId()
  const gcpProjectId = useId()
  const gcpLocationId = useId()
  const [state, setState] = useState<AntigravityAuthState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [showCallback, setShowCallback] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [gcpProjectInput, setGcpProjectInput] = useState('')
  const [gcpLocationInput, setGcpLocationInput] = useState('us-central1')
  const mounted = useRef(false)
  const stateRef = useRef(state)
  const revision = useRef(0)
  const changed = useRef(onAuthChanged)
  changed.current = onAuthChanged

  const apply = useCallback((next: AntigravityAuthState, notifyChange = false) => {
    if (!mounted.current) return
    const prev = stateRef.current
    if (
      notifyChange ||
      (next.status === 'signed_in' && pending(prev)) ||
      (prev && prev.status !== next.status)
    ) {
      changed.current?.()
    }
    stateRef.current = next
    setState(next)
    setGcpProjectInput(next.config?.gcpProject ?? '')
    setGcpLocationInput(next.config?.gcpLocation || 'us-central1')
  }, [])

  const request = useCallback(
    async (action: AntigravityAuthRequest, notifyChange = false) => {
      const current = ++revision.current
      setBusy(true)
      setError('')
      try {
        const next = await api(action)
        if (!mounted.current) {
          if (action.action === 'start' && next.loginId) {
            void api({ action: 'cancel', loginId: next.loginId }).catch(() => {})
          }
          return
        }
        if (current === revision.current) apply(next, notifyChange)
      } catch (cause) {
        if (mounted.current && current === revision.current) {
          setError(cause instanceof Error ? cause.message : t('antigravityAuth.unknownError'))
        }
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
      const current = stateRef.current
      if (pending(current) && current?.loginId) {
        void api({ action: 'cancel', loginId: current.loginId }).catch(() => {})
      }
    }
  }, [api, request])

  useEffect(() => {
    if (!pending(state)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const current = revision.current
      try {
        const next = await api({ action: 'status' })
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
  }, [api, apply, state?.status, t])

  const active = pending(state)
  const connected = state?.status === 'signed_in'
  const method: AntigravityAuthMethod = state?.config?.authMethod ?? 'oauth-personal'
  const isOAuthMethod = method === 'oauth-personal' || method === 'oauth-business'
  const needsApiKey = method === 'gemini-api-key' || method === 'agent-platform'
  const needsGcpConfig = method === 'oauth-business' || method === 'agent-platform'

  const openBrowser = async () => {
    if (!state?.authUrl) return
    try {
      await requestOpenExternalLink(state.authUrl)
    } catch {
      setError(t('antigravityAuth.browserError'))
    }
  }

  const statusText = !state
    ? t('antigravityAuth.checking')
    : active
      ? t(
          state.status === 'starting'
            ? 'antigravityAuth.starting'
            : state.status === 'verifying'
              ? 'antigravityAuth.verifying'
              : 'antigravityAuth.waiting',
        )
      : connected
        ? t('antigravityAuth.signedIn')
        : state.status === 'unavailable'
          ? t('antigravityAuth.unavailable')
          : t('antigravityAuth.signedOut')

  const hint = connected
    ? (state.email || t(AUTH_METHOD_LABEL_KEYS[method]))
    : state?.status === 'signed_out'
      ? `${t('settings.harnesses.needsAuth')} ${t('antigravityAuth.signedOutHint')}`
      : state?.status === 'unavailable'
        ? t('antigravityAuth.installHint')
        : undefined

  const handleMethodChange = (nextMethod: string) => {
    void request(
      {
        action: 'configure',
        authMethod: nextMethod as AntigravityAuthMethod,
      },
      true,
    )
  }

  const handleSaveConfig = async (event: React.FormEvent) => {
    event.preventDefault()
    await request(
      {
        action: 'configure',
        authMethod: method,
        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
        ...(needsGcpConfig
          ? {
              gcpProject: gcpProjectInput.trim(),
              gcpLocation: gcpLocationInput.trim() || 'us-central1',
            }
          : {}),
      },
      true,
    )
    setApiKeyInput('')
    toast.success(t('antigravityAuth.configSaved'))
  }

  const handleClearApiKey = async () => {
    setApiKeyInput('')
    await request({ action: 'configure', authMethod: method, clearApiKey: true }, true)
  }

  return (
    <section className="flex w-full flex-col gap-3" aria-label={t('antigravityAuth.title')}>
      <SettingsCard>
        <SettingsRow
          label={
            <span role="status" className="flex items-center gap-2">
              {active && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
              {connected && <Check className="size-3.5 shrink-0 text-success" />}
              <span>{statusText}</span>
            </span>
          }
          description={hint ? <span className={cn(connected && 'block truncate')}>{hint}</span> : undefined}
        >
          {!active && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={busy}
                onClick={() => void request({ action: 'refresh' })}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {t('antigravityAuth.refresh')}
              </Button>
              {isOAuthMethod && !connected && state?.status !== 'unavailable' && (
                <Button
                  size="sm"
                  className="h-7"
                  disabled={busy || !state}
                  onClick={() => {
                    setCallbackUrl('')
                    setShowCallback(false)
                    void request({ action: 'start', authMethod: method })
                  }}
                >
                  {state?.status === 'error' ? t('antigravityAuth.retry') : t('antigravityAuth.signIn')}
                </Button>
              )}
              {connected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={busy}
                  onClick={() => void request({ action: 'logout' }, true)}
                >
                  <LogOut className="size-3.5" />
                  {t('antigravityAuth.signOut')}
                </Button>
              )}
            </div>
          )}
        </SettingsRow>

        <SettingsRow label={t('antigravityAuth.methodLabel')}>
          <Select value={method} onValueChange={handleMethodChange} disabled={busy || active}>
            <SelectTrigger size="sm" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oauth-personal">{t('antigravityAuth.methods.oauthPersonal')}</SelectItem>
              <SelectItem value="oauth-business">{t('antigravityAuth.methods.oauthBusiness')}</SelectItem>
              <SelectItem value="gemini-api-key">{t('antigravityAuth.methods.geminiApiKey')}</SelectItem>
              <SelectItem value="agent-platform">{t('antigravityAuth.methods.agentPlatform')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {(needsApiKey || needsGcpConfig) && (
          <form onSubmit={(e) => void handleSaveConfig(e)} className={cn(settingsRowClassName, 'flex flex-col gap-3')}>
            {needsApiKey && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={apiKeyId} className="text-xs">
                    {t('antigravityAuth.apiKeyLabel')}
                  </Label>
                  {state?.config?.hasApiKey && (
                    <span className="text-xs text-success">{t('antigravityAuth.apiKeySaved')}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={apiKeyId}
                    type="password"
                    className="h-8 min-w-0 flex-1 basis-48 bg-background"
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    placeholder={t('antigravityAuth.apiKeyPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy || active}
                  />
                  {state?.config?.hasApiKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      disabled={busy || active}
                      onClick={() => void handleClearApiKey()}
                    >
                      {t('antigravityAuth.clearApiKey')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {needsGcpConfig && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={gcpProjectId} className="text-xs">
                    {t('antigravityAuth.gcpProjectLabel')}
                  </Label>
                  <Input
                    id={gcpProjectId}
                    className="h-8 bg-background"
                    value={gcpProjectInput}
                    onChange={(event) => setGcpProjectInput(event.target.value)}
                    placeholder={t('antigravityAuth.gcpProjectPlaceholder')}
                    spellCheck={false}
                    disabled={busy || active}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={gcpLocationId} className="text-xs">
                    {t('antigravityAuth.gcpLocationLabel')}
                  </Label>
                  <Input
                    id={gcpLocationId}
                    className="h-8 bg-background"
                    value={gcpLocationInput}
                    onChange={(event) => setGcpLocationInput(event.target.value)}
                    placeholder={t('antigravityAuth.gcpLocationPlaceholder')}
                    spellCheck={false}
                    disabled={busy || active}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" size="sm" className="h-7" disabled={busy || active}>
                {t('antigravityAuth.saveConfig')}
              </Button>
            </div>
          </form>
        )}

        {active && (
          <div className={cn(settingsRowClassName, 'flex flex-col gap-3')}>
            <div className="flex flex-wrap gap-2">
              {state?.authUrl && (
                <Button size="sm" className="h-7" onClick={() => void openBrowser()}>
                  <ExternalLink className="size-3.5" />
                  {t('antigravityAuth.openBrowser')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={busy}
                onClick={() => state?.loginId && void request({ action: 'cancel', loginId: state.loginId })}
              >
                {t('antigravityAuth.cancel')}
              </Button>
            </div>
            {state?.status === 'waiting' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="group h-7 self-start"
                  aria-controls={`${callbackId}-form`}
                  aria-expanded={showCallback}
                  onClick={() => setShowCallback(!showCallback)}
                >
                  <ChevronDown className="size-3.5 transition-transform group-aria-expanded:rotate-180" />
                  {t('antigravityAuth.haveCallback')}
                </Button>
                {showCallback && (
                  <form
                    id={`${callbackId}-form`}
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (state.loginId && callbackUrl.trim()) {
                        void request({
                          action: 'submitCallback',
                          loginId: state.loginId,
                          callbackUrl: callbackUrl.trim(),
                        })
                      }
                    }}
                  >
                    <Label htmlFor={callbackId} className="text-xs">
                      {t('antigravityAuth.callbackLabel')}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id={callbackId}
                        className="h-7 min-w-0 flex-1 basis-40 bg-background"
                        value={callbackUrl}
                        onChange={(event) => setCallbackUrl(event.target.value)}
                        placeholder={t('antigravityAuth.callbackPlaceholder')}
                        autoComplete="off"
                        maxLength={4096}
                        spellCheck={false}
                        disabled={busy}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="h-7"
                        disabled={!callbackUrl.trim() || busy}
                      >
                        {t('antigravityAuth.submitCallback')}
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </SettingsCard>
      {(error || state?.status === 'error') && (
        <Alert variant="destructive">
          <AlertTitle>{t('antigravityAuth.failed')}</AlertTitle>
          <AlertDescription className="break-words">{error || state?.error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
