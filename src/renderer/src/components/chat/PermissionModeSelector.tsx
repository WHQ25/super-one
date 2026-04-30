import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount } from '@/stores/chat'
import { useMemo, useState } from 'react'
import { eligibilityFromStore } from '@/lib/auto-mode-eligibility'
import { PermissionModeList, modes, PERMISSION_MODES } from './PermissionModeList'

export { modes, PERMISSION_MODES }

interface PermissionModeSelectorProps {
  compact?: boolean
}

export function PermissionModeSelector({ compact = false }: PermissionModeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((s) => s.permissionMode)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)

  const autoEligibility = useMemo(
    () => eligibilityFromStore(account, availableModels.find((m) => m.id === selectedModel)),
    [account, selectedModel, availableModels],
  )

  const current = modes.find((m) => m.id === permissionMode) ?? modes[0]
  const currentLabel = t(`chat.permissionModes.${current.id}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${current.color} ${current.hoverBg}`}
          title={currentLabel}
        >
          {current.icon}
          {!compact && <span>{currentLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-52 border-border bg-card p-1"
      >
        <PermissionModeList
          activeMode={permissionMode}
          autoEligibility={autoEligibility}
          onSelect={(mode) => {
            setPermissionMode(mode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
