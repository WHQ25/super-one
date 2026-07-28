import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { AutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { modes, PermissionModeList } from './PermissionModeList'

export function PermissionModePopover({
  activeMode,
  availableModes,
  autoEligibility,
  compact = false,
  onSelect,
}: {
  activeMode: PermissionMode
  availableModes: PermissionMode[]
  autoEligibility?: AutoModeEligibility
  compact?: boolean
  onSelect: (mode: PermissionMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = modes.find((mode) => mode.id === activeMode && availableModes.includes(mode.id)) ?? modes[0]
  const currentLabel = t(`chat.permissionModes.${current.id}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${current.color} ${current.hoverBg}`}
          title={currentLabel}
        >
          {current.icon}
          {!compact && <span>{currentLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-52 border-border bg-popover p-1">
        <PermissionModeList
          activeMode={activeMode}
          availableModes={availableModes}
          autoEligibility={autoEligibility}
          onSelect={(mode) => {
            onSelect(mode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
