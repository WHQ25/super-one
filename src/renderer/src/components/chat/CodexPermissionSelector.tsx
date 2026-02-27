import { useState } from 'react'
import { ShieldCheck, ShieldOff, AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { DEFAULT_CODEX_PERMISSION_PRESET, type CodexPermissionPreset } from '../../../../shared/agent-types'

const options: Array<{
  id: CodexPermissionPreset
  label: string
  icon: React.ReactNode
  toneClass: string
}> = [
  {
    id: 'default',
    label: 'Default',
    icon: <ShieldCheck className="size-3.5" />,
    toneClass: 'text-foreground',
  },
  {
    id: 'full-access',
    label: 'Full Access',
    icon: <AlertTriangle className="size-3.5" />,
    toneClass: 'text-destructive',
  },
]

export function CodexPermissionSelector() {
  const [open, setOpen] = useState(false)
  const selectedPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const setSelectedPreset = useChatStore((s) => s.setSelectedCodexPermissionPreset)
  const preset: CodexPermissionPreset = selectedPreset || DEFAULT_CODEX_PERMISSION_PRESET
  const presetLabel = preset === 'full-access' ? 'Full Access' : 'Default'

  const modeIcon = preset === 'full-access'
    ? <ShieldOff className="size-3" />
    : <ShieldCheck className="size-3" />

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${
            preset === 'full-access'
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {modeIcon}
          <span>{presetLabel}</span>
          <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 border-border bg-card p-2">
        <div className="space-y-1 text-xs">
          <div className="px-2 py-1.5 text-muted-foreground">Permission Preset</div>
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setSelectedPreset(option.id)
                setOpen(false)
              }}
              className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
                option.id === preset
                  ? 'bg-muted text-foreground'
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 font-medium ${option.toneClass}`}>
                  {option.icon}
                  {option.label}
                </span>
                {option.id === preset && <Check className="size-3.5 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
