import { useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'

/**
 * ACP session-mode picker (configOptions category=mode), e.g. OpenCode-style modes.
 *
 * Grok reasoning-effort options also arrive as acpModes but with `acpModeConfigId === null`
 * and are switched via session/set_model + _meta.reasoningEffort — those render inside
 * GroupedModelEffortSelector (model row), not here.
 */
export function AcpModeSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const acpModes = useActiveSession((s) => s.acpModes)
  const acpModeConfigId = useActiveSession((s) => s.acpModeConfigId)
  const selectedAcpModeId = useActiveSession((s) => s.selectedAcpModeId)
  const acpModesStatus = useActiveSession((s) => s.acpModesStatus)
  const { setSelectedAcpMode } = useScopedSessionActions()

  // configId null ⇒ Grok effort catalog → AcpModelSelector / GroupedModelEffortSelector
  if (!acpModeConfigId) return null
  if (acpModesStatus === 'loading' && acpModes.length === 0) return null
  if (acpModes.length === 0) return null

  const current = acpModes.find((m) => m.id === selectedAcpModeId) ?? acpModes[0]
  const label = current?.name || current?.id || t('chat.sessionModeTitle')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={current?.description || label}
        >
          <Layers className="size-3" />
          {!compact && <span className="max-w-30 truncate">{label}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-56 border-border bg-popover p-1"
      >
        <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('chat.sessionModeTitle')}
        </div>
        {acpModes.map((mode) => {
          const active = mode.id === (selectedAcpModeId ?? current?.id)
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                setSelectedAcpMode(mode.id)
                setOpen(false)
              }}
              className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent ${
                active ? 'bg-accent' : ''
              }`}
            >
              <span className="text-xs font-medium text-foreground">{mode.name || mode.id}</span>
              {mode.description ? (
                <span className="mt-0.5 text-xs text-muted-foreground">{mode.description}</span>
              ) : null}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
