import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ListTodo, MessageCircle, Unlock, Zap } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useActiveSession, useChatStore } from '@/stores/chat'
import {
  ACP_PERMISSION_MODES,
  ACP_PERMISSION_MODE_META,
  type AcpPermissionModeId,
  type AcpPermissionModeMeta,
} from './acpPermissionModes'

type Option = AcpPermissionModeMeta & { icon: ReactNode }

const OPTIONS: Option[] = ACP_PERMISSION_MODE_META.map((meta) => ({
  ...meta,
  icon:
    meta.id === 'plan' ? <ListTodo className="size-3" />
    : meta.id === 'auto' ? <Zap className="size-3" />
    : meta.id === 'bypassPermissions' ? <Unlock className="size-3" />
    : <MessageCircle className="size-3" />,
}))

/**
 * Grok Build permission baseline selector.
 * Same shell as Claude/Codex status-bar popovers; options/labels are Grok-only.
 */
export function AcpPermissionSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const setPermissionMode = useChatStore((state) => state.setPermissionMode)

  useEffect(() => {
    if (!ACP_PERMISSION_MODES.includes(permissionMode as AcpPermissionModeId)) {
      setPermissionMode('default')
    }
  }, [permissionMode, setPermissionMode])

  const active = OPTIONS.find((o) => o.id === permissionMode) ?? OPTIONS[0]
  const activeLabel = t(`chat.acpPermissionModes.${active.labelKey}.label`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${active.color} ${active.hoverBg}`}
          title={activeLabel}
        >
          {active.icon}
          {!compact && <span>{activeLabel}</span>}
          {!compact && (
            <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-56 border-border bg-popover p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {t('chat.acpPermissionModes.title')}
        </div>
        {OPTIONS.map((option) => {
          const selected = option.id === active.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setPermissionMode(option.id)
                setOpen(false)
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                selected
                  ? `${option.activeBg} text-foreground`
                  : `text-foreground ${option.hoverBg}`
              }`}
            >
              <div className={`flex items-center gap-1.5 font-medium ${option.color}`}>
                {option.icon}
                {t(`chat.acpPermissionModes.${option.labelKey}.label`)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {t(`chat.acpPermissionModes.${option.labelKey}.description`)}
              </div>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
