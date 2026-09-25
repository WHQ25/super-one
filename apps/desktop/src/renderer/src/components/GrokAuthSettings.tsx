import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@superone/ui/components/ui/alert'
import type { GrokAuthRequest, GrokAuthState } from '@superone/shared/grok-auth'
import { cn } from '@superone/ui/lib/utils'
import { requestOpenExternalLink } from '@/lib/external-link'
import { SettingsCard, SettingsRow, settingsRowClassName } from '@/components/settings/SettingsSection'

export type GrokAuthApi = (request: GrokAuthRequest) => Promise<GrokAuthState>
const defaultApi: GrokAuthApi = (request) => window.app.grokAuth(request)
const pending = (state: GrokAuthState | null) => !!state && ['starting', 'waiting', 'verifying'].includes(state.status)

/** Settings-only login. No conversation, permission prompt, or chat tools involved. */
export function GrokAuthSettings({ api = defaultApi, onAuthChanged }: {
  api?: GrokAuthApi
  onAuthChanged?: () => void
}) {
  const { t } = useTranslation()
  const codeId = useId()
  const [state, setState] = useState<GrokAuthState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const mounted = useRef(false)
  const stateRef = useRef(state)
  const revision = useRef(0)
  const changed = useRef(onAuthChanged)
  changed.current = onAuthChanged
  const apply = useCallback((next: GrokAuthState) => {
    if (!mounted.current) return
    if (next.status === 'signed_in' && pending(stateRef.current)) changed.current?.()
    stateRef.current = next
    setState(next)
  }, [])

  const request = useCallback(async (action: GrokAuthRequest) => {
    const current = ++revision.current
    setBusy(true)
    setError('')
    try {
      const next = await api(action)
      if (!mounted.current) {
        if (action.action === 'start' && next.loginId) void api({ action: 'cancel', loginId: next.loginId }).catch(() => {})
        return
      }
      if (current === revision.current) apply(next)
    } catch (cause) {
      if (mounted.current && current === revision.current) setError(cause instanceof Error ? cause.message : t('grokAuth.unknownError'))
    } finally {
      if (mounted.current && current === revision.current) setBusy(false)
    }
  }, [api, apply, t])

  useEffect(() => {
    mounted.current = true
    void request({ action: 'refresh' })
    return () => {
      mounted.current = false
      ++revision.current
      const current = stateRef.current
      if (pending(current) && current?.loginId) void api({ action: 'cancel', loginId: current.loginId }).catch(() => {})
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
        if (!stopped) setError(cause instanceof Error ? cause.message : t('grokAuth.unknownError'))
      }
      if (!stopped) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [api, apply, state?.status, t])

  const active = pending(state)
  const connected = state?.status === 'signed_in'
  const openBrowser = async () => {
    if (!state?.authUrl) return
    try { await requestOpenExternalLink(state.authUrl) } catch { setError(t('grokAuth.browserError')) }
  }
  const statusText = !state ? t('grokAuth.checking')
    : active ? t(state.status === 'starting' ? 'grokAuth.starting' : state.status === 'verifying' ? 'grokAuth.verifying' : 'grokAuth.waiting')
    : connected ? t('grokAuth.signedIn')
    : state.status === 'unavailable' ? t('grokAuth.unavailable') : t('grokAuth.signedOut')

  const hint = connected
    ? (state.email || (state.method?.includes('api_key') ? t('grokAuth.apiKey') : undefined))
    : state?.status === 'signed_out' ? t('grokAuth.signedOutHint')
    : state?.status === 'unavailable' ? t('grokAuth.installHint')
    : undefined

  return (
    <section className="flex w-full flex-col gap-3" aria-label={t('grokAuth.title')}>
      <SettingsCard>
        <SettingsRow
          label={(
            <span role="status" className="flex items-center gap-2">
              {active && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
              {connected && <Check className="size-3.5 shrink-0 text-success" />}
              <span>{statusText}</span>
            </span>
          )}
          description={hint ? <span className={cn(connected && 'block truncate')}>{hint}</span> : undefined}
        >
          {!active && <>
            <Button variant="ghost" size="sm" className="h-7" disabled={busy} onClick={() => void request({ action: 'refresh' })}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{t('grokAuth.refresh')}
            </Button>
            {!connected && state?.status !== 'unavailable' && (
              <Button size="sm" className="h-7" disabled={busy || !state} onClick={() => { setCode(''); setShowCode(false); void request({ action: 'start' }) }}>
                {state?.status === 'error' ? t('grokAuth.retry') : t('grokAuth.signIn')}
              </Button>
            )}
          </>}
        </SettingsRow>
        {active && (
          <div className={cn(settingsRowClassName, 'flex flex-col gap-3')}>
            <div className="flex flex-wrap gap-2">
              {state?.authUrl && <Button size="sm" className="h-7" onClick={() => void openBrowser()}><ExternalLink className="size-3.5" />{t('grokAuth.openBrowser')}</Button>}
              <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => state?.loginId && void request({ action: 'cancel', loginId: state.loginId })}>{t('grokAuth.cancel')}</Button>
            </div>
            {state?.status === 'waiting' && (
              <>
                <Button size="sm" variant="ghost" className="group h-7 self-start" aria-controls={`${codeId}-form`} aria-expanded={showCode} onClick={() => setShowCode(!showCode)}><ChevronDown className="size-3.5 transition-transform group-aria-expanded:rotate-180" />{t('grokAuth.haveCode')}</Button>
                {showCode && <form id={`${codeId}-form`} className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (state.loginId) void request({ action: 'submit', loginId: state.loginId, code }) }}>
                  <Label htmlFor={codeId} className="text-xs">{t('grokAuth.codeLabel')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input id={codeId} className="h-7 min-w-0 flex-1 basis-40 bg-background" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" maxLength={4096} spellCheck={false} disabled={busy} />
                    <Button type="submit" variant="outline" size="sm" className="h-7" disabled={!code.trim() || busy}>{t('grokAuth.submit')}</Button>
                  </div>
                </form>}
              </>
            )}
          </div>
        )}
      </SettingsCard>
      {(error || state?.status === 'error') && <Alert variant="destructive"><AlertTitle>{t('grokAuth.failed')}</AlertTitle><AlertDescription className="break-words">{error || state?.error}</AlertDescription></Alert>}
    </section>
  )
}
