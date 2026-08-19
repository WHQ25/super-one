import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Check, ChevronDown } from 'lucide-react'
import type { DeepseekPresetInfo } from '@superone/shared/agent-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useChatStore } from '@/stores/chat'

/**
 * The dsh agent-preset picker — the harness's own "mode" vocabulary.
 *
 * A preset is a whole agent composition, so choosing one changes the tool
 * catalog and the system prompt. dsh allows the change only while a session has
 * produced nothing, because swapping the catalog mid-conversation would strand
 * tool calls already in the log; the roster answers `switchable` and this
 * control goes read-only once that is false.
 */
export function DeepseekPresetSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()
  const sessionId = useActiveSession((state) => state._providerSessionId)
  const draft = useActiveSession((state) => state.dshPreset)
  const setPreset = useChatStore((state) => state.setDshPreset)

  const [presets, setPresets] = useState<DeepseekPresetInfo[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [switchable, setSwitchable] = useState(true)

  const load = useCallback(async () => {
    const roster = await window.app.listDeepseekPresets(sessionId ?? undefined)
    setPresets(roster.presets)
    setCurrent(roster.current)
    setSwitchable(roster.switchable)
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  // The live composition wins over the draft: a resumed session recomposes from
  // its own log, so the store's pick may name a preset this session never ran.
  const selectedId = current ?? draft ?? presets[0]?.id ?? null
  const selected = presets.find((preset) => preset.id === selectedId)

  const choose = useCallback(async (preset: DeepseekPresetInfo) => {
    if (preset.id === selectedId) return
    setPreset(preset.id)
    // With no live agent the pick is a draft the next creation reads; with one,
    // it is a real recomposition that can still be refused.
    if (sessionId !== null && current !== null) {
      await window.app.setDeepseekPreset(sessionId, preset.id)
    }
    await load()
  }, [selectedId, sessionId, current, setPreset, load])

  if (presets.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!switchable}
        className={cn(
          'flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground',
          switchable ? 'hover:bg-muted hover:text-foreground' : 'cursor-default',
        )}
        title={switchable ? undefined : t('chatDshPreset.locked')}
      >
        <Boxes className="size-3.5 shrink-0" />
        <span className="truncate">{selected?.name ?? t('chatDshPreset.label')}</span>
        {switchable && <ChevronDown className="size-3 shrink-0" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        {presets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            disabled={preset.broken !== null}
            onSelect={() => { void choose(preset) }}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="flex w-full items-center gap-2 text-xs font-medium">
              {preset.name}
              {preset.id === selectedId && <Check className="ml-auto size-3.5 shrink-0" />}
            </span>
            {/* A broken preset stays listed with its reason: hiding it would
                leave its directory blocking the id with nothing to see. */}
            <span className={cn('text-2xs', preset.broken !== null ? 'text-destructive' : 'text-muted-foreground')}>
              {preset.broken ?? preset.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
