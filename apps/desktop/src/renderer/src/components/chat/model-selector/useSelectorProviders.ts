import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { claudeAccountProviderId, type ClaudeAccount, type HarnessId } from '@superone/shared/agent-types'
import { type Credential } from '@superone/shared/platform-registry'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { consumerForHarness, credentialsForConsumer, providerDisplayForCredential, resolveEffectiveProviderId } from '@/lib/provider-resolve'
import type { SelectorProviderOption } from './GroupedModelEffortSelector'

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
  const consumer = consumerForHarness(harness)

  return useMemo(
    () => resolveEffectiveProviderId(platforms, credentials, bindings, consumer, apiProviderId, {
      experimentalClaudeOpenAiChatEnabled,
    }),
    [apiProviderId, platforms, credentials, bindings, consumer, experimentalClaudeOpenAiChatEnabled],
  )
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
  const resolvedProviderId = useResolvedProviderId(harness)

  // Keep scope aligned with host even if chat opened without a host-switch path.
  useEffect(() => {
    const next =
      selectedHostConnectionId && selectedHostConnectionId !== 'local'
        ? selectedHostConnectionId
        : 'local'
    if (next !== providerScope) {
      useSettingsStore.getState().setProviderScope(next)
    }
  }, [selectedHostConnectionId, providerScope])

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])

  const [claudeAccounts, setClaudeAccounts] = useState<ClaudeAccount[]>([])
  useEffect(() => {
    if (harness !== 'claude') return
    let cancelled = false
    window.app.claudeListAccounts()
      .then((accounts) => { if (!cancelled) setClaudeAccounts(accounts.filter((a) => a.loggedIn)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [harness])

  const consumer = consumerForHarness(harness)
  const filtered = useMemo<Credential[]>(
    () => credentialsForConsumer(platforms, credentials, consumer, { experimentalClaudeOpenAiChatEnabled }),
    [platforms, credentials, consumer, experimentalClaudeOpenAiChatEnabled],
  )

  const providers = useMemo<SelectorProviderOption[]>(() => {
    const defaultLabel = harness === 'codex'
      ? t('resources.providers.defaultLabelCodex')
      : t('resources.providers.defaultLabelClaude')
    // With one Claude account the list is byte-identical to before multi-account existed: the
    // default login as a single unlabelled row. The email column only appears once there is a
    // second account to tell apart, so single-account users never see the feature.
    const list: SelectorProviderOption[] =
      harness === 'claude' && claudeAccounts.length > 1
        ? claudeAccounts.map((account) => ({
            id: claudeAccountProviderId(account.credentialDir),
            brand: 'claude',
            name: defaultLabel,
            keyName: claudeAccountKeyName(account, claudeAccounts),
          }))
        : [{ id: null, brand: harness === 'codex' ? 'openai' : 'claude', name: defaultLabel }]
    for (const c of filtered) {
      const { brand, name, icon } = providerDisplayForCredential(platforms, c)
      list.push({ id: c.id, brand, name, icon, keyName: c.name })
    }
    return list
  }, [filtered, platforms, harness, t, claudeAccounts])

  return {
    providers,
    selectedProviderId: resolvedProviderId,
    onSelectProvider: (id: string | null) => { void setSessionApiProviderId(id) },
    onManageProviders: () => { setSettingsTab('providers'); navigateTo('settings') },
  }
}
