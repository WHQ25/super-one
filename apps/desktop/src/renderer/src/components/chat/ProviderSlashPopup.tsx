import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, ChevronRight } from 'lucide-react'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { ProviderLabel } from '@/components/ProviderLabel'
import { consumerForHarness, credentialsForConsumer, providerDisplayForCredential } from '@/lib/provider-resolve'
import { type Credential } from '@superone/shared/platform-registry'

interface ProviderItem {
  id: string | null
  brand: string | null
  label: string
  /** Site favicon for custom platforms, which have no brand icon. */
  icon?: string | null
  keyName?: string
}

export function ProviderSlashPopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const harness = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider)
  const status = useActiveSession((s) => s.status)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const { setSessionApiProviderId } = useScopedSessionActions()
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const isStreaming = status === 'streaming'

  useEffect(() => { void fetchProviderData() }, [fetchProviderData])

  const consumer = consumerForHarness(harness)
  const filtered = useMemo<Credential[]>(
    () => credentialsForConsumer(platforms, credentials, consumer, { experimentalClaudeOpenAiChatEnabled }),
    [platforms, credentials, consumer, experimentalClaudeOpenAiChatEnabled],
  )

  const items = useMemo<ProviderItem[]>(() => {
    const defaultLabel = harness === 'codex'
      ? t('resources.providers.defaultLabelCodex')
      : t('resources.providers.defaultLabelClaude')
    const list: ProviderItem[] = [{ id: null, brand: harness === 'codex' ? 'openai' : 'claude', label: defaultLabel }]
    for (const c of filtered) {
      // Main label = platform name (shown beside the site favicon when the brand has no icon,
      // e.g. custom providers); the key name is the secondary badge on the right.
      const { brand, name, icon } = providerDisplayForCredential(platforms, c)
      list.push({ id: c.id, brand, label: name, icon, keyName: c.name })
    }
    return list
  }, [filtered, platforms, harness, t])

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = items.findIndex((i) => i.id === apiProviderId)
    return idx >= 0 ? idx : 0
  })
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const setItemRef = (idx: number) => (el: HTMLButtonElement | null) => {
    if (el) itemRefs.current.set(idx, el)
    else itemRefs.current.delete(idx)
  }

  useEffect(() => {
    if (selectedIndex >= items.length) setSelectedIndex(items.length - 1)
  }, [items.length, selectedIndex])

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const openProvidersSettings = () => {
    onClose()
    setSettingsTab('providers')
    navigateTo('settings')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, items.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex < items.length) {
          void setSessionApiProviderId(items[selectedIndex].id)
        } else {
          openProvidersSettings()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, selectedIndex, setSessionApiProviderId, onClose])

  return (
    <div className="flex max-h-72 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t('chat.providerPopup.title')}</span>
        {isStreaming && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t('chat.providerPopup.willSwitchAfterStreaming')}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {items.map((item, idx) => {
          const isCurrent = item.id === apiProviderId
          const isSelected = idx === selectedIndex
          return (
            <button
              key={item.id ?? '__default__'}
              ref={setItemRef(idx)}
              type="button"
              onMouseEnter={() => setSelectedIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); void setSessionApiProviderId(item.id) }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected ? 'bg-primary/15' : 'hover:bg-muted/40'
              }`}
            >
              <ProviderLabel brandKey={item.brand} fallback={item.label} icon={item.icon} size={20} />
              <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                {item.id && item.keyName && (
                  <span className="truncate text-xs text-muted-foreground">{item.keyName}</span>
                )}
                {isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
              </span>
            </button>
          )
        })}

        <div className="my-1 border-t border-border" />

        <button
          ref={setItemRef(items.length)}
          type="button"
          onMouseEnter={() => setSelectedIndex(items.length)}
          onMouseDown={(e) => { e.preventDefault(); openProvidersSettings() }}
          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
            selectedIndex === items.length ? 'bg-primary/15' : 'hover:bg-muted/40'
          }`}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Plus className="size-4" />
            <span>{t('chat.providerPopup.addProvider')}</span>
          </div>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}
