import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import type { ChatProvider } from '@/stores/chat'
import { isCatalogHarnessEnabled, type HarnessCatalogStatus } from '@/lib/harness-visibility'

let rememberedHarnessCatalog: HarnessCatalogStatus[] | null = null
let cursorHarnessBootstrapped = false
let deepseekHarnessBootstrapped = false

export function resetBootstrapHarnessMemoryForTests(): void {
  rememberedHarnessCatalog = null
  cursorHarnessBootstrapped = false
  deepseekHarnessBootstrapped = false
}

export function useBootstrapHarnesses(
  initializeHarness: (provider: ChatProvider) => Promise<void>,
): HarnessCatalogStatus[] | null {
  const appHarnessCatalog = useAppStore((s) => s.harnessCatalog)
  const [localHarnessCatalog, setHarnessCatalog] = useState<HarnessCatalogStatus[] | null>(
    () => appHarnessCatalog ?? rememberedHarnessCatalog,
  )

  useEffect(() => {
    void initializeHarness('acp-grok')
    void initializeHarness('acp-antigravity')
  }, [initializeHarness])

  useEffect(() => {
    if (!isCatalogHarnessEnabled(localHarnessCatalog, 'cursor')) return
    if (cursorHarnessBootstrapped) return
    cursorHarnessBootstrapped = true
    void initializeHarness('cursor')
  }, [localHarnessCatalog, initializeHarness])

  useEffect(() => {
    if (!isCatalogHarnessEnabled(localHarnessCatalog, 'dsh')) return
    if (deepseekHarnessBootstrapped) return
    deepseekHarnessBootstrapped = true
    void initializeHarness('dsh')
  }, [localHarnessCatalog, initializeHarness])

  useEffect(() => {
    let cancelled = false
    window.app
      .listHarnesses?.()
      .then((list) => {
        if (cancelled) return
        rememberedHarnessCatalog = Array.isArray(list)
          ? list.map((r) => ({ id: r.id, enabled: r.enabled, state: r.state }))
          : null
        setHarnessCatalog(rememberedHarnessCatalog)
      })
      .catch(() => {
        if (!cancelled) setHarnessCatalog(rememberedHarnessCatalog)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!appHarnessCatalog) return
    rememberedHarnessCatalog = appHarnessCatalog
    setHarnessCatalog(appHarnessCatalog)
  }, [appHarnessCatalog])

  return localHarnessCatalog
}

export function NoHarnessEnabledState() {
  const { t } = useTranslation()
  const openHarnessSettings = () => {
    useAppStore.getState().setSettingsTab('harnesses')
    useAppStore.getState().navigateTo('settings')
  }
  return (
    <div className="flex flex-col items-center gap-2 px-4">
      <p className="text-sm text-muted-foreground">{t('chat.suggestions.noHarnessEnabled')}</p>
      <button
        type="button"
        onClick={openHarnessSettings}
        className="text-xs font-medium text-primary hover:underline"
      >
        {t('chat.suggestions.enableHarnesses')}
      </button>
    </div>
  )
}
