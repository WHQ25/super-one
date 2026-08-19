import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Eye, ShieldCheck, ShieldOff } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { PermissionMode } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import {
  DEEPSEEK_DEFAULT_PERMISSION_MODE,
  DEEPSEEK_PERMISSION_MODES,
  DEEPSEEK_PERMISSION_MODE_META,
  deepseekPermissionModeMeta,
} from './deepseekPermissionModes'

/**
 * dsh presets rather than SuperOne's generic mode names, because the preset is
 * what happens: it decides the sandbox the shell and filesystem run under, not
 * only whether a popover appears. Reusing `PermissionModeList` would label
 * `read-only` as "Plan Mode", which dsh does not have.
 */
const TONE: Record<string, { icon: React.ReactNode; color: string; hoverBg: string; activeBg: string }> = {
  'read-only': {
    icon: <Eye className="size-3" />,
    color: 'text-blue-600 dark:text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
    activeBg: 'bg-blue-500/15',
  },
  'workspace-write': {
    icon: <ShieldCheck className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  'danger-full-access': {
    icon: <ShieldOff className="size-3" />,
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
    activeBg: 'bg-destructive/15',
  },
}

export function DeepseekPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const setPermissionMode = useChatStore((state) => state.setPermissionMode)

  useEffect(() => {
    if (!DEEPSEEK_PERMISSION_MODES.includes(permissionMode)) {
      setPermissionMode(DEEPSEEK_DEFAULT_PERMISSION_MODE)
    }
  }, [permissionMode, setPermissionMode])

  const current = deepseekPermissionModeMeta(permissionMode)
  const currentTone = TONE[current.preset]
  const currentLabel = t(current.labelKey)

  const select = (mode: PermissionMode): void => {
    setPermissionMode(mode)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${currentTone.color} ${currentTone.hoverBg}`}
          title={currentLabel}
        >
          {currentTone.icon}
          {!compact && <span>{currentLabel}</span>}
          {!compact && <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 border-border bg-popover p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.permissionModeTitle')}</div>
        {DEEPSEEK_PERMISSION_MODE_META.map((meta) => {
          const tone = TONE[meta.preset]
          const active = meta.mode === permissionMode
          return (
            <button
              key={meta.mode}
              onClick={() => select(meta.mode)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                active ? `${tone.activeBg} text-foreground` : `text-foreground ${tone.hoverBg}`
              }`}
            >
              <div className={`flex items-center gap-1.5 font-medium ${tone.color}`}>
                {tone.icon}
                {t(meta.labelKey)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t(meta.descriptionKey)}</div>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
