import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { AcpPermissionModeList, acpPermissionModeOption } from './AcpPermissionModeList'
import { ACP_PERMISSION_MODES, type AcpPermissionModeId } from './acpPermissionModes'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'

/**
 * Grok Build permission baseline selector.
 * Same shell as Claude/Codex status-bar popovers; options/labels are Grok-only.
 */
export function AcpPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const { setPermissionMode } = useScopedSessionActions()

  useEffect(() => {
    if (!ACP_PERMISSION_MODES.includes(permissionMode as AcpPermissionModeId)) {
      setPermissionMode('default')
    }
  }, [permissionMode, setPermissionMode])

  const active = acpPermissionModeOption(permissionMode)
  const activeLabel = t(`chat.acpPermissionModes.${active.labelKey}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${active.color} ${active.hoverBg}`}
          title={activeLabel}
        >
          {active.icon}
          {!compact && <span>{activeLabel}</span>}
          {!compact && (
            <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className={PERMISSION_POPOVER_CLASS}>
        <AcpPermissionModeList
          activeMode={active.id}
          onSelect={(mode) => {
            setPermissionMode(mode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
