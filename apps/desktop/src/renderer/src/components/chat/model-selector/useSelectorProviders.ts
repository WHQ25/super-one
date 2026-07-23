import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { HarnessId } from '@superone/shared/agent-types'
import { findPlatform, type Credential } from '@superone/shared/platform-registry'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { brandOfCredential, consumerForHarness, credentialsForConsumer, resolveEffective } from '@/lib/provider-resolve'
import type { SelectorProviderOption } from './GroupedModelEffortSelector'

export function useSelectorProviders(harness: HarnessId) {
  const { t } = useTranslation()
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const setSessionApiProviderId = useChatStore((s) => s.setSessionApiProviderId)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)

  useEffect(() => { void fetchProviderData() }, [fetchProviderData])

  const consumer = consumerForHarness(harness)
  const filtered = useMemo<Credential[]>(
    () => credentialsForConsumer(platforms, credentials, consumer),
    [platforms, credentials, consumer],
  )

  // When the session has no explicit override, show the globally-bound default provider,
  // not the abstract "Default" entry — resolveEffective mirrors the main-process selection.
  const resolvedProviderId = useMemo(() => {
    if (apiProviderId) return apiProviderId
    return resolveEffective(platforms, credentials, bindings, consumer, apiProviderId)?.credential.id ?? null
  }, [apiProviderId, platforms, credentials, bindings, consumer])

  const providers = useMemo<SelectorProviderOption[]>(() => {
    const defaultLabel = harness === 'codex'
      ? t('resources.providers.defaultLabelCodex')
      : t('resources.providers.defaultLabelClaude')
    const list: SelectorProviderOption[] = [
      { id: null, brand: harness === 'codex' ? 'openai' : 'claude', name: defaultLabel },
    ]
    for (const c of filtered) {
      const name = findPlatform(platforms, c.platformId)?.name ?? c.name
      list.push({ id: c.id, brand: brandOfCredential(platforms, c), name, keyName: c.name })
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
