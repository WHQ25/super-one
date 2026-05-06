import { Box, PackageOpen, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useState } from 'react'
import type { SandboxMode } from '@superone/shared/agent-types'

export const sandboxModes: { id: SandboxMode; label: string; triggerLabel: string; description: string; icon: React.ReactNode; color: string; hoverBg: string }[] = [
  {
    id: 'off',
    label: 'Sandbox Off',
    triggerLabel: 'Off',
    description: 'No execution isolation',
    icon: <PackageOpen className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-muted',
  },
  {
    id: 'on',
    label: 'Sandbox',
    triggerLabel: 'On',
    description: 'Commands run in sandboxed environment',
    icon: <Box className="size-3" />,
    color: 'text-emerald-400',
    hoverBg: 'hover:bg-emerald-500/10',
  },
  {
    id: 'auto',
    label: 'Sandbox Auto',
    triggerLabel: 'Auto',
    description: 'Sandbox with auto-allow Bash',
    icon: <Box className="size-3" />,
    color: 'text-amber-600 dark:text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
  },
]

function getSandboxMode(info: { enabled: boolean; autoAllowBash: boolean }): SandboxMode {
  if (!info.enabled) return 'off'
  return info.autoAllowBash ? 'auto' : 'on'
}

interface SandboxModeSelectorProps {
  compact?: boolean
}

export function SandboxModeSelector({ compact = false }: SandboxModeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const sandboxInfo = useActiveSession((s) => s.sandboxInfo)
  const setSandboxMode = useChatStore((s) => s.setSandboxMode)

  const currentMode = getSandboxMode(sandboxInfo)
  const current = sandboxModes.find((m) => m.id === currentMode) ?? sandboxModes[1]
  const currentLabel = t(`chat.sandboxModes.${current.id}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${current.color} ${current.hoverBg}`}
          title={currentLabel}
        >
          {current.icon}
          {!compact && <span>{current.triggerLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-56 border-border bg-card p-1"
      >
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.sandboxModeTitle')}</div>
        {sandboxModes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              setSandboxMode(mode.id)
              setOpen(false)
            }}
            className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
              mode.id === currentMode
                ? 'bg-muted text-foreground'
                : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
              {mode.icon}
              {t(`chat.sandboxModes.${mode.id}.label`)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{t(`chat.sandboxModes.${mode.id}.description`)}</div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
