import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ProviderLabel } from '@/components/ProviderLabel'
import { apiKeyDefault } from '@/harness-ui/api-key-defaults'
import { useProviderScopeSync } from '@/hooks/useProviderScopeSync'
import { consumerForHarness, resolveEffective } from '@/lib/provider-resolve'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

export function ActiveProviderHint() {
  const { t } = useTranslation()
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)

  useProviderScopeSync()

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])

  const builtIn = apiKeyDefault(preferredProvider)
  if (!builtIn) return null

  const effective = resolveEffective(
    platforms,
    credentials,
    bindings,
    consumerForHarness(preferredProvider),
    sessionApiProviderId,
    { experimentalClaudeOpenAiChatEnabled },
  )

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t('chat.suggestions.poweredBy')}</span>
      <ProviderLabel
        brandKey={effective?.brand ?? builtIn.brand}
        fallback={effective?.platform.name ?? t(builtIn.labelKey)}
        icon={effective?.platform.icon}
        size={12}
        compactFallback
      />
    </span>
  )
}
