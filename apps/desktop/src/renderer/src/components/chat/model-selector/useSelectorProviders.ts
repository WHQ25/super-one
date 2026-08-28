import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { HarnessId } from '@superone/shared/agent-types'
import { type Credential } from '@superone/shared/platform-registry'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { consumerForHarness, credentialsForConsumer, providerDisplayForCredential, resolveEffectiveProviderId } from '@/lib/provider-resolve'
import type { SelectorProviderOption } from './GroupedModelEffortSelector'

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
  const setSessionApiProviderId = useChatStore((s) => s.setSessionApiProviderId)
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

  const consumer = consumerForHarness(harness)
  const filtered = useMemo<Credential[]>(
    () => credentialsForConsumer(platforms, credentials, consumer, { experimentalClaudeOpenAiChatEnabled }),
    [platforms, credentials, consumer, experimentalClaudeOpenAiChatEnabled],
  )

  const providers = useMemo<SelectorProviderOption[]>(() => {
    const defaultLabel = harness === 'codex'
      ? t('resources.providers.defaultLabelCodex')
      : t('resources.providers.defaultLabelClaude')
    const list: SelectorProviderOption[] = [
      { id: null, brand: harness === 'codex' ? 'openai' : 'claude', name: defaultLabel },
    ]
    for (const c of filtered) {
      const { brand, name, icon } = providerDisplayForCredential(platforms, c)
      list.push({ id: c.id, brand, name, icon, keyName: c.name })
    }
    return list
  }, [filtered, platforms, harness, t])

  return {
    providers,
    selectedProviderId: resolvedProviderId,
    onSelectProvider: (id: string | null) => { void setSessionApiProviderId(id) },
    onManageProviders: () => { setSettingsTab('providers'); navigateTo('settings') },
  }
}
