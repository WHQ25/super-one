import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Braces, Check, ChevronDown, Feather, Layers, Puzzle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DeepseekPresetInfo } from '@superone/shared/agent-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'

/**
 * A mark per shipped preset, keyed by id rather than by name or order.
 *
 * The roster is discovered from directories, so ids are the only stable handle:
 * `preset.yml` names are translated prose and `order` is authoring metadata a
 * locally added preset can shift. Anything not shipped here — a preset the user
 * authored — keeps the generic mark instead of borrowing a meaning it does not
 * have.
 */
const PRESET_ICONS: Record<string, LucideIcon> = {
  standard: Layers,
  code: Braces,
  minimal: Feather,
  cordis: Puzzle,
}

const SHIPPED_PRESET_COPY = {
  standard: {
    name: 'chatDshPreset.presets.standard.name',
    description: 'chatDshPreset.presets.standard.description',
  },
  code: {
    name: 'chatDshPreset.presets.code.name',
    description: 'chatDshPreset.presets.code.description',
  },
  minimal: {
    name: 'chatDshPreset.presets.minimal.name',
    description: 'chatDshPreset.presets.minimal.description',
  },
  cordis: {
    name: 'chatDshPreset.presets.cordis.name',
    description: 'chatDshPreset.presets.cordis.description',
  },
} as const

export function deepseekPresetCopy(
  preset: DeepseekPresetInfo,
  t: ReturnType<typeof useTranslation>['t'],
): { name: string; description: string | null } {
  const keys = preset.trust === 'system'
    ? SHIPPED_PRESET_COPY[preset.id as keyof typeof SHIPPED_PRESET_COPY]
    : undefined
  return keys
    ? { name: t(keys.name), description: t(keys.description) }
    : { name: preset.name, description: preset.description }
}

export function deepseekPresetIcon(id: string | null): LucideIcon {
  return (id !== null ? PRESET_ICONS[id] : undefined) ?? Boxes
}

export function useDeepseekPresetSelection() {
  const { t } = useTranslation()
  const sessionId = useActiveSession((state) => state._providerSessionId)
  const draft = useActiveSession((state) => state.dshPreset)
  const hasStarted = useActiveSession((state) => state.messages.length > 0)
  const { setDshPreset: setPreset } = useScopedSessionActions()

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
  const selectedCopy = selected ? deepseekPresetCopy(selected, t) : null

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

  return { presets, selectedId, selectedCopy, switchable: switchable && !hasStarted, choose }
}

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
  const { presets, selectedId, selectedCopy, switchable, choose } = useDeepseekPresetSelection()
  const SelectedIcon = deepseekPresetIcon(selectedId)

  if (presets.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!switchable}
        className={cn(
          'group flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground',
          switchable ? 'hover:bg-muted hover:text-foreground' : 'cursor-default',
        )}
        title={switchable ? undefined : t('chatDshPreset.locked')}
      >
        <SelectedIcon className="size-3.5 shrink-0" />
        <span className="truncate">{selectedCopy?.name ?? t('chatDshPreset.label')}</span>
        {/* Radix stamps `data-state` on the trigger, so the caret follows the
            menu without this component tracking its open state. */}
        {switchable && (
          <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        {presets.map((preset) => {
          const Icon = deepseekPresetIcon(preset.id)
          const copy = deepseekPresetCopy(preset, t)
          return (
            <DropdownMenuItem
              key={preset.id}
              disabled={preset.broken !== null}
              onSelect={() => { void choose(preset) }}
              className="flex items-start gap-2 py-2"
            >
              <Icon className="mt-0.5 size-3.5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex w-full items-center gap-2 text-xs font-medium">
                  {copy.name}
                  {preset.id === selectedId && <Check className="ml-auto size-3.5 shrink-0" />}
                </span>
                {/* A broken preset stays listed with its reason: hiding it would
                    leave its directory blocking the id with nothing to see. */}
                <span className={cn('text-2xs', preset.broken !== null ? 'text-destructive' : 'text-muted-foreground')}>
                  {preset.broken ?? copy.description}
                </span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
