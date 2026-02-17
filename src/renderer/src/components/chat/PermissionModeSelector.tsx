import { Shield, FastForward, ShieldOff, PenLine, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useState } from 'react'
import type { PermissionMode } from '../../../../shared/agent-types'

/** Ordered list of permission modes — used for cycling via Shift+Tab. */
export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export const modes: { id: PermissionMode; label: string; description: string; icon: React.ReactNode; color: string; hoverBg: string }[] = [
  {
    id: 'default',
    label: 'Normal',
    description: 'Prompts for dangerous operations',
    icon: <Shield className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-muted',
  },
  {
    id: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-accept file edit operations',
    icon: <FastForward className="size-3" />,
    color: 'text-purple-400',
    hoverBg: 'hover:bg-purple-500/10',
  },
  {
    id: 'plan',
    label: 'Plan Mode',
    description: 'Planning only, no actual execution',
    icon: <PenLine className="size-3" />,
    color: 'text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
  },
  {
    id: 'bypassPermissions',
    label: 'Bypass',
    description: 'Bypass all permission checks',
    icon: <ShieldOff className="size-3" />,
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
  },
]

export function PermissionModeSelector() {
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((s) => s.permissionMode)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)

  const current = modes.find((m) => m.id === permissionMode) ?? modes[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${current.color} ${current.hoverBg}`}>
          {current.icon}
          <span>{current.label}</span>
          <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-52 border-border bg-card p-1"
      >
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              setPermissionMode(mode.id)
              setOpen(false)
            }}
            className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
              mode.id === permissionMode
                ? 'bg-muted text-foreground'
                : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
              {mode.icon}
              {mode.label}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{mode.description}</div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
