import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { codexAccountProviderId, type CodexAccount, type CodexManagedLoginStart } from '@superone/shared/codex-accounts'
import { useChatStore } from '@/stores/chat'
import type { CodexAccountMeters } from './CodexAccountMeters'
import { CodexAccountsPanel } from './CodexAccountsPanel'

export function CodexAuthSettings({ onAuthChanged }: { onAuthChanged?: () => void }) {
  const { t } = useTranslation()
  const projectPath = useChatStore((s) => s.activeProject)
  const [accounts, setAccounts] = useState<CodexAccount[]>([])
  const [meters, setMeters] = useState<Record<string, CodexAccountMeters>>({})
  const [pending, setPending] = useState<CodexManagedLoginStart | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const meterRequest = useRef(0)
  const onChanged = useRef(onAuthChanged)
  onChanged.current = onAuthChanged
  const changed = useCallback(() => {
    window.dispatchEvent(new Event('codex-accounts-changed'))
    onChanged.current?.()
  }, [])

  const refresh = useCallback(async () => {
    if (!projectPath) return []
    const current = generation.current
    const request = ++meterRequest.current
    setLoading(true)
    try {
      const result = await window.app.codexListAccounts(projectPath) ?? []
      if (current === generation.current && request === meterRequest.current) {
        setAccounts(result)
        setError(null)
        const signedInAccounts = result.filter((a) => a.signedIn && !a.unavailable)
        setMeters(Object.fromEntries(signedInAccounts.map((a) => [a.id, { loading: true }])))
        for (const account of signedInAccounts) {
          const providerId = codexAccountProviderId(account.id)
          void Promise.allSettled([
            window.app.codexGetRateLimits(projectPath, providerId),
            window.app.codexGetAccountUsage(projectPath, providerId),
          ]).then(([limits, usage]) => {
            if (current !== generation.current || request !== meterRequest.current) return
            setMeters((previous) => ({ ...previous, [account.id]: {
              limits: limits.status === 'fulfilled' ? limits.value : null,
              usage: usage.status === 'fulfilled' ? usage.value : null,
              error: limits.status === 'rejected' || usage.status === 'rejected',
            } }))
          })
        }
      }
      return result
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : String(error))
      return []
    } finally { if (current === generation.current && request === meterRequest.current) setLoading(false) }
  }, [projectPath])

  useEffect(() => {
    generation.current++
    setAccounts([])
    setMeters({})
    setBusy(false)
    setPending(null)
    void refresh()
    return () => { generation.current++ }
  }, [refresh])

  useEffect(() => {
    if (!pending || !projectPath) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + 15 * 60_000
    const poll = async () => {
      try {
        const result = await window.app.codexListAccounts(projectPath) ?? []
        if (cancelled) return
        setAccounts(result)
        const account = result.find((a) => a.id === pending.accountId)
        if (account?.signedIn && account.loginState !== 'pending') {
          setPending(null)
          changed()
          void refresh()
          return
        }
        if (account?.loginState === 'failed' || Date.now() > deadline) {
          setPending(null)
          setError(t('settings.harnesses.codexAccount.loginFailed'))
          return
        }
      } catch (error) {
        if (cancelled) return
        setError(error instanceof Error ? error.message : String(error))
      }
      if (!cancelled) timer = setTimeout(poll, 1500)
    }
    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pending, projectPath, changed, refresh, t])

  const action = async (run: (path: string) => Promise<void>) => {
    if (!projectPath || busy) return
    const current = generation.current
    setBusy(true)
    setError(null)
    try { await run(projectPath) }
    catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (current === generation.current) setBusy(false) }
  }

  return <CodexAccountsPanel
    accounts={accounts} meters={meters} loading={loading} busy={busy} pending={pending}
    disabled={!projectPath} error={!projectPath ? t('settings.harnesses.codexAccount.noProject') : error}
    onRefresh={() => { void refresh() }}
    onSignIn={(id) => { void action(async (path) => { const current = generation.current; const result = await window.app.codexStartAccountLogin(path, id); if (current !== generation.current) { await window.app.codexCancelAccountLogin(path, result.loginId); return }; setPending(result); await refresh() }) }}
    onSignOut={(id) => { void action(async (path) => { await window.app.codexLogoutAccount(path, codexAccountProviderId(id)); await refresh(); changed() }) }}
    onSetDefault={(id) => { void action(async (path) => { await window.app.codexSetDefaultAccount(path, id); await refresh(); changed() }) }}
    onCancel={() => { void action(async (path) => { if (pending) await window.app.codexCancelAccountLogin(path, pending.loginId); setPending(null); await refresh() }) }}
    onOpenLogin={() => { const url = pending?.authUrl ?? pending?.verificationUrl; if (url) void window.app.openExternalLink(url) }}
    onCopyCode={() => { if (pending?.userCode) void navigator.clipboard.writeText(pending.userCode).then(() => toast.success(t('settings.harnesses.codexAccount.codeCopied'))).catch((error) => setError(String(error))) }}
  />
}
