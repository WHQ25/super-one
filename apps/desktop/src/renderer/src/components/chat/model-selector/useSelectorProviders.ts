import { useClaudeAccounts } from '@/hooks/useClaudeAccounts'
import { codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'
import { useChatStore } from '@/stores/chat'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { claudeAccountProviderId, type ClaudeAccount, type HarnessId } from '@superone/shared/agent-types'
import { type Credential } from '@superone/shared/platform-registry'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { consumerForHarness, credentialsForConsumer, providerDisplayForCredential, resolveEffectiveProviderId } from '@/lib/provider-resolve'
import { subscriptionHost } from '@/lib/provider-host'
import { apiKeyDefaultFor } from '@/harness-ui/api-key-defaults'
import type { SelectorProviderOption } from './GroupedModelEffortSelector'

function useChatProjectPath(): string | null {
  const scope = useSessionScope()
  const activeProject = useChatStore((s) => s.activeProject)
  return scope?.projectPath ?? activeProject
}

/** Claude accounts for the machine this chat runs on. A remote host never falls back to this desktop. */
function useHostClaudeAccounts(connectionId: string | null, enabled: boolean): ClaudeAccount[] {
  const local = useClaudeAccounts(enabled && !connectionId)
  const [remoteAccounts, setRemoteAccounts] = useState<ClaudeAccount[]>([])
  useEffect(() => {
    if (!enabled || !connectionId) return
    let cancelled = false
    setRemoteAccounts([])
    const load = (force = false) => {
      void window.environment.listRemoteClaudeAccounts(connectionId, force)
        .then((rows) => { if (!cancelled) setRemoteAccounts(Array.isArray(rows) ? rows : []) })
        .catch(() => { if (!cancelled) setRemoteAccounts([]) })
    }
    load()
    const refresh = (event: Event) => {
      const detailId = event instanceof CustomEvent ? event.detail?.connectionId : undefined
      if (typeof detailId === 'string' && detailId !== connectionId) return
      load(true)
    }
    window.addEventListener('claude-accounts-changed', refresh)
    return () => { cancelled = true; window.removeEventListener('claude-accounts-changed', refresh) }
  }, [connectionId, enabled])
  return connectionId ? remoteAccounts : local
}

/**
 * What goes in the row's key column for a Claude account. Email alone is not enough: plans are
 * org-scoped, so the same email can appear twice under different orgs — those are two accounts
 * with two separate usage pools, and two identical rows would be unpickable. The org is appended
 * only when it is actually needed to tell rows apart, to keep the common case short.
 */
export function claudeAccountKeyName(account: ClaudeAccount, all: readonly ClaudeAccount[]): string | undefined {
  const email = account.email?.trim()
  if (!email) return account.orgName?.trim() || undefined
  const sameEmail = all.filter((other) => other.email?.trim() === email)
  if (sameEmail.length < 2) return email
  const org = account.orgName?.trim()
  return org ? `${email} · ${org}` : email
}

export function useResolvedProviderId(harness: HarnessId): string | null {
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const consumer = consumerForHarness(harness)
  const accountHost = subscriptionHost(useChatProjectPath(), selectedHostConnectionId)
  const accounts = useHostClaudeAccounts(accountHost, harness === 'claude')

  const resolved = useMemo(
    () => resolveEffectiveProviderId(platforms, credentials, bindings, consumer, apiProviderId, {
      experimentalClaudeOpenAiChatEnabled,
    }),
    [apiProviderId, platforms, credentials, bindings, consumer, experimentalClaudeOpenAiChatEnabled],
  )
  const defaultAccount = accounts.find((a) => a.isDefault)
  return resolved ?? (harness === 'claude' && defaultAccount ? claudeAccountProviderId(defaultAccount.credentialDir) : null)
}

export function useSelectorProviders(harness: HarnessId) {
  const { t } = useTranslation()
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const { setSessionApiProviderId } = useScopedSessionActions()
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const projectPath = useChatProjectPath()
  const accountHost = subscriptionHost(projectPath, selectedHostConnectionId)
  const resolvedProviderId = useResolvedProviderId(harness)

  // Credentials follow the machine this chat runs on, which is the open project
  // when there is one and the sidebar host only before a project is chosen.
  useEffect(() => {
    const next = accountHost ?? 'local'
    if (next !== providerScope) {
      useSettingsStore.getState().setProviderScope(next)
    }
  }, [accountHost, providerScope])

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])

  const claudeAccounts = useHostClaudeAccounts(accountHost, harness === 'claude')
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([])
  useEffect(() => {
    setCodexAccounts([])
    if (harness !== 'codex' || !projectPath) return
    let cancelled = false
    const refresh = () => { void window.app.codexListAccounts(projectPath)
      .then((accounts) => { if (!cancelled) setCodexAccounts(accounts) })
      .catch(() => {}) }
    refresh()
    window.addEventListener('codex-accounts-changed', refresh)
    return () => { cancelled = true; window.removeEventListener('codex-accounts-changed', refresh) }
  }, [harness, projectPath, providerScope])

  const consumer = consumerForHarness(harness)
  const filtered = useMemo<Credential[]>(
    () => credentialsForConsumer(platforms, credentials, consumer, { experimentalClaudeOpenAiChatEnabled }),
    [platforms, credentials, consumer, experimentalClaudeOpenAiChatEnabled],
  )

  const providers = useMemo<SelectorProviderOption[]>(() => {
    const builtIn = apiKeyDefaultFor(harness)
    const defaultLabel = t(builtIn.labelKey)
    const list: SelectorProviderOption[] =
      harness === 'codex' && codexAccounts.length > 0
        ? codexAccounts.filter((account) => account.signedIn || codexAccountProviderId(account.id) === resolvedProviderId).map((account) => ({
            id: codexAccountProviderId(account.id), brand: 'openai', name: defaultLabel,
            keyName: [account.email || account.id, account.signedIn ? account.planType : t('settings.harnesses.codexAccount.signedOut')].filter(Boolean).join(' · '),
          }))
        : harness === 'claude' && claudeAccounts.length > 0
        ? claudeAccounts.filter((account) => account.loggedIn || claudeAccountProviderId(account.credentialDir) === resolvedProviderId).map((account) => ({
            id: claudeAccountProviderId(account.credentialDir),
            brand: 'claude',
            name: defaultLabel,
            keyName: claudeAccountKeyName(account, claudeAccounts),
          }))
        : [{ id: null, brand: builtIn.brand, name: defaultLabel }]
    for (const c of filtered) {
      const { brand, name, icon } = providerDisplayForCredential(platforms, c)
      list.push({ id: c.id, brand, name, icon, keyName: c.name })
    }
    return list
  }, [filtered, platforms, harness, t, claudeAccounts, codexAccounts, resolvedProviderId])

  return {
    providers,
    selectedProviderId: resolvedProviderId ?? (harness === 'codex' && codexAccounts.some((a) => a.isDefault) ? codexAccountProviderId(codexAccounts.find((a) => a.isDefault)!.id) : null),
    onSelectProvider: (id: string | null) => { void setSessionApiProviderId(id) },
    onManageProviders: () => { setSettingsTab('providers'); navigateTo('settings') },
  }
}
