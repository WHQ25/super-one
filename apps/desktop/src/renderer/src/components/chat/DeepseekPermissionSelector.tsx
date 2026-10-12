import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { PermissionMode } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { DeepseekPermissionModeList, deepseekPermissionModeOption } from './DeepseekPermissionModeList'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'

const { permissionModes: DSH_MODES, defaultPermissionMode: DSH_DEFAULT_MODE } = HARNESS_LAUNCH_OPTIONS.dsh

export function DeepseekPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const { setPermissionMode } = useScopedSessionActions()

  useEffect(() => {
    if (!DSH_MODES.includes(permissionMode)) setPermissionMode(DSH_DEFAULT_MODE)
  }, [permissionMode, setPermissionMode])

  const current = deepseekPermissionModeOption(permissionMode)
  const currentLabel = t(current.labelKey)

  const select = (mode: PermissionMode): void => {
    setPermissionMode(mode)
    setOpen(false)
  }

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
      <PopoverContent align="start" side="top" className={PERMISSION_POPOVER_CLASS}>
        <DeepseekPermissionModeList activeMode={permissionMode} onSelect={select} />
      </PopoverContent>
    </Popover>
  )
}
