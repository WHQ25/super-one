import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { HarnessId, PermissionMode } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { PERMISSION_POPOVER_CLASS } from './permissionPopoverStyles'

/**
 * Permission selector for a session that does not exist yet: same per-harness vocabulary the
 * status bar shows (`StatusBarPermission`), but driven by props instead of the active session.
 */
export function HarnessPermissionPopover({
  harnessId,
  value,
  onChange,
}: {
  harnessId: HarnessId
  /** Unset shows the harness's own default, which is what the launch would start in. */
  value?: PermissionMode
  onChange: (mode: PermissionMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const view = HARNESS_CONTROLS[harnessId].launchPermission?.(
    value ?? HARNESS_LAUNCH_OPTIONS[harnessId].defaultPermissionMode,
    (mode) => {
      onChange(mode)
      setOpen(false)
    },
  )
  if (!view) return null
  const label = t(view.labelKey)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${view.toneClass}`}
          title={label}
        >
          {view.icon}
          <span>{label}</span>
          <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className={PERMISSION_POPOVER_CLASS}>
        {view.content}
      </PopoverContent>
    </Popover>
  )
}
