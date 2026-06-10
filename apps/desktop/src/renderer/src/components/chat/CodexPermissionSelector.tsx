import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, ShieldCheck, ShieldOff, AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { DEFAULT_CODEX_PERMISSION_PRESET, type CodexPermissionPreset } from '@superone/shared/agent-types'

interface CodexPermissionSelectorProps {
  compact?: boolean
}

interface PresetOption {
  id: CodexPermissionPreset
  label: string
  description: string
  icon: React.ReactNode
  triggerIcon: React.ReactNode
  toneClass: string
  triggerToneClass: string
  hoverBg: string
  activeBg: string
}

export function CodexPermissionSelector({ compact = false }: CodexPermissionSelectorProps) {
  const { t } = useTranslation()
  const options: PresetOption[] = [
    {
      id: 'read-only',
      label: t('resources.automation.readOnly'),
      description: t('resources.automation.readOnlyDesc'),
      icon: <Eye className="size-3.5" />,
      triggerIcon: <Eye className="size-3" />,
      toneClass: 'text-foreground',
      triggerToneClass: 'text-muted-foreground hover:bg-muted',
      hoverBg: 'hover:bg-accent',
      activeBg: 'bg-accent',
    },
    {
      id: 'default',
      label: t('resources.automation.defaultValue'),
      description: t('resources.automation.defaultDesc'),
      icon: <ShieldCheck className="size-3.5" />,
      triggerIcon: <ShieldCheck className="size-3" />,
      toneClass: 'text-foreground',
      triggerToneClass: 'text-muted-foreground hover:bg-muted',
      hoverBg: 'hover:bg-accent',
      activeBg: 'bg-accent',
    },
    {
      id: 'full-access',
      label: t('resources.automation.fullAccess'),
      description: t('resources.automation.fullAccessDesc'),
      icon: <AlertTriangle className="size-3.5" />,
      triggerIcon: <ShieldOff className="size-3" />,
      toneClass: 'text-destructive',
      triggerToneClass: 'text-destructive hover:bg-destructive/10',
      hoverBg: 'hover:bg-destructive/10',
      activeBg: 'bg-destructive/15',
    },
  ]
  const [open, setOpen] = useState(false)
  const selectedPreset = useActiveSession((s) => s.selectedCodexPermissionPreset)
  const setSelectedPreset = useChatStore((s) => s.setSelectedCodexPermissionPreset)
  const preset: CodexPermissionPreset = selectedPreset || DEFAULT_CODEX_PERMISSION_PRESET
  const activeOption = options.find((o) => o.id === preset) ?? options[1]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${activeOption.triggerToneClass}`}
          title={activeOption.label}
        >
          {activeOption.triggerIcon}
          {!compact && <span>{activeOption.label}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 border-border bg-popover p-2">
        <div className="space-y-1 text-xs">
          <div className="px-2 py-1.5 text-muted-foreground">{t('chat.codex.permissionPreset')}</div>
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setSelectedPreset(option.id)
                setOpen(false)
              }}
              className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
                option.id === preset
                  ? `${option.activeBg} text-foreground`
                  : `text-foreground ${option.hoverBg}`
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={`inline-flex items-center gap-1.5 font-medium ${option.toneClass}`}>
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                {option.id === preset && <Check className="size-3.5 shrink-0 mt-0.5" />}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
