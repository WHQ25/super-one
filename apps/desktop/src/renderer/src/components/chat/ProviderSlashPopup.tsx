import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, ChevronRight } from 'lucide-react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { ProviderLabel } from '@/components/ProviderLabel'
import type { ApiProvider } from '@superone/shared/agent-types'

interface ProviderItem {
  id: string | null
  provider: ApiProvider | null
  label: string
}

export function ProviderSlashPopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const harness = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider)
  const status = useActiveSession((s) => s.status)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const providers = useSettingsStore((s) => s.providers)
  const fetchProviders = useSettingsStore((s) => s.fetchProviders)
  const setSessionApiProviderId = useChatStore((s) => s.setSessionApiProviderId)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const isStreaming = status === 'streaming'

  useEffect(() => { void fetchProviders() }, [fetchProviders])

  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      try {
        const supported = JSON.parse(p.supported_agents || '["claude"]') as string[]
        return Array.isArray(supported) && supported.includes(harness)
      } catch {
        return harness === 'claude'
      }
    })
  }, [providers, harness])

  const items = useMemo<ProviderItem[]>(() => {
    const defaultLabel = harness === 'codex'
      ? t('resources.providers.defaultLabelCodex')
      : t('resources.providers.defaultLabelClaude')
    const list: ProviderItem[] = [{ id: null, provider: null, label: defaultLabel }]
    for (const p of filteredProviders) {
      list.push({ id: p.id, provider: p, label: p.name })
    }
    return list
  }, [filteredProviders, harness, t])

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = items.findIndex((i) => i.id === apiProviderId)
    return idx >= 0 ? idx : 0
  })
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (selectedIndex >= items.length) setSelectedIndex(items.length - 1)
  }, [items.length, selectedIndex])

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

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

  const openProvidersSettings = () => {
    onClose()
    setSettingsTab('providers')
    navigateTo('settings')
  }

  return (
    <div className="flex max-h-72 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">{t('chat.providerPopup.title')}</span>
        {isStreaming && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
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
              ref={(el) => { if (el) itemRefs.current.set(idx, el); else itemRefs.current.delete(idx) }}
              type="button"
              onMouseEnter={() => setSelectedIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); void setSessionApiProviderId(item.id) }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected ? 'bg-accent' : 'hover:bg-muted/50'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {item.provider ? (
                  <ProviderLabel provider={item.provider} fallback={item.label} size={20} />
                ) : (
                  <span className="text-sm text-foreground">{item.label}</span>
                )}
              </div>
              {isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          )
        })}

        <div className="my-1 border-t border-border" />

        <button
          ref={(el) => { if (el) itemRefs.current.set(items.length, el); else itemRefs.current.delete(items.length) }}
          type="button"
          onMouseEnter={() => setSelectedIndex(items.length)}
          onMouseDown={(e) => { e.preventDefault(); openProvidersSettings() }}
          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
            selectedIndex === items.length ? 'bg-accent' : 'hover:bg-muted/50'
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
