import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import {
  CURSOR_DEFAULT_PERMISSION_MODE,
  CURSOR_PERMISSION_MODES,
  resolveCursorPermissionMode,
} from './cursorPermissionModes'
import { CursorPermissionModeList, cursorPermissionModeOption } from './CursorPermissionModeList'

/**
 * Status-bar permission control for Cursor sessions.
 * Offers Agent / Plan / Full Access only.
 */
export function CursorPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const { setPermissionMode } = useScopedSessionActions()

  // New Cursor sessions default to Claude's `default` mode. Latch the coerce
  // so a no-op / failed write cannot re-arm this effect (same class as the
  // CursorModelSelector empty-params #185).
  const coercedRef = useRef(false)
  useEffect(() => {
    if (CURSOR_PERMISSION_MODES.includes(permissionMode)) return
    if (coercedRef.current) return
    coercedRef.current = true
    void setPermissionMode(CURSOR_DEFAULT_PERMISSION_MODE)
  }, [permissionMode, setPermissionMode])

  const current = cursorPermissionModeOption(resolveCursorPermissionMode(permissionMode))
  const currentLabel = t(`chat.cursorPermissionModes.${current.labelKey}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${current.color} ${current.hoverBg}`}
          title={currentLabel}
        >
          {current.icon}
          {!compact && <span>{currentLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-56 border-border bg-popover p-1">
        <CursorPermissionModeList
          activeMode={current.id}
          availableModes={CURSOR_PERMISSION_MODES}
          onSelect={(mode) => {
            setPermissionMode(mode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
