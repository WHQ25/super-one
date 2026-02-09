import { Shield, ShieldCheck, ShieldOff, PenLine } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatStore } from '@/stores/chat'
import { useState } from 'react'
import type { PermissionMode } from '../../../../shared/agent-types'

/** Ordered list of permission modes — used for cycling via Shift+Tab. */
export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

const modes: { id: PermissionMode; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  {
    id: 'default',
    label: 'Normal',
    description: 'Prompts for dangerous operations',
    icon: <Shield className="size-3" />,
    color: 'text-neutral-400',
  },
  {
    id: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-accept file edit operations',
    icon: <ShieldCheck className="size-3" />,
    color: 'text-amber-400',
  },
  {
    id: 'plan',
    label: 'Plan Mode',
    description: 'Planning only, no actual execution',
    icon: <PenLine className="size-3" />,
    color: 'text-blue-400',
  },
  {
    id: 'bypassPermissions',
    label: 'Bypass',
    description: 'Bypass all permission checks',
    icon: <ShieldOff className="size-3" />,
    color: 'text-red-400',
  },
]

export function PermissionModeSelector() {
  const [open, setOpen] = useState(false)
  const permissionMode = useChatStore((s) => s.permissionMode)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)

  const current = modes.find((m) => m.id === permissionMode) ?? modes[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`flex items-center gap-1 text-[11px] transition-colors hover:text-neutral-300 ${current.color}`}>
          {current.icon}
          <span>{current.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-52 border-neutral-700 bg-neutral-800 p-1"
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
                ? 'bg-neutral-700 text-white'
                : 'text-neutral-300 hover:bg-neutral-700/50'
            }`}
          >
            <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
              {mode.icon}
              {mode.label}
            </div>
            <div className="mt-0.5 text-[10px] text-neutral-500">{mode.description}</div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
