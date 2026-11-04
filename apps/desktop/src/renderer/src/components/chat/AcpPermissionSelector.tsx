import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { noteAcpAutoFailClosed } from '@/lib/acp-auto-honesty'
import { AcpPermissionModeList, acpPermissionModeOption } from './AcpPermissionModeList'
import { acpPermissionModesForAgent, type AcpPermissionModeId } from './acpPermissionModes'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'

export function AcpPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const acpAgentId = useActiveSession((state) => state.acpAgentId)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const { setPermissionMode } = useScopedSessionActions()
  const allowedModes = acpPermissionModesForAgent(acpAgentId)

  useEffect(() => {
    if (!allowedModes.includes(permissionMode as AcpPermissionModeId)) {
      setPermissionMode('default')
    }
  }, [allowedModes, permissionMode, setPermissionMode])

  const active = acpPermissionModeOption(permissionMode, acpAgentId)
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
          agentId={acpAgentId}
          onSelect={(mode) => {
            if (mode === 'auto' && !isAntigravityAcpAgent(acpAgentId)) {
              noteAcpAutoFailClosed(toast.info, t('chat.acpPermissionModes.autoFailClosedToast'))
            }
            setPermissionMode(mode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
