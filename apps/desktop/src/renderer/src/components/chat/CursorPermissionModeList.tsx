import { FastForward, PenLine, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import { CURSOR_PERMISSION_MODES } from './cursorPermissionModes'

export interface CursorPermissionModeOption {
  id: PermissionMode
  labelKey: 'agent' | 'plan' | 'fullAccess'
  descriptionKey: 'agent' | 'plan' | 'fullAccess'
  icon: React.ReactNode
  color: string
  hoverBg: string
  activeBg: string
}

export const cursorPermissionModeOptions: CursorPermissionModeOption[] = [
  {
    id: 'agent',
    labelKey: 'agent',
    descriptionKey: 'agent',
    icon: <FastForward className="size-3" />,
    color: 'text-amber-500 dark:text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
    activeBg: 'bg-amber-500/15',
  },
  {
    id: 'plan',
    labelKey: 'plan',
    descriptionKey: 'plan',
    icon: <PenLine className="size-3" />,
    color: 'text-blue-600 dark:text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
    activeBg: 'bg-blue-500/15',
  },
  {
    id: 'bypassPermissions',
    labelKey: 'fullAccess',
    descriptionKey: 'fullAccess',
    icon: <ShieldOff className="size-3" />,
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
    activeBg: 'bg-destructive/15',
  },
]

/**
 * Resolve the Cursor permission option for a mode id (falls back to Agent).
 */
export function cursorPermissionModeOption(mode: PermissionMode): CursorPermissionModeOption {
  const id = mode === 'auto' ? 'agent' : mode
  return cursorPermissionModeOptions.find((option) => option.id === id) ?? cursorPermissionModeOptions[0]
}

interface CursorPermissionModeListProps {
  activeMode: PermissionMode
  availableModes?: PermissionMode[]
  onSelect: (mode: PermissionMode) => void
}

/**
 * Permission mode list for Cursor: Agent / Plan / Full Access.
 */
export function CursorPermissionModeList({
  activeMode,
  availableModes = CURSOR_PERMISSION_MODES,
  onSelect,
}: CursorPermissionModeListProps) {
  const { t } = useTranslation()
  const visible = cursorPermissionModeOptions.filter((option) => availableModes.includes(option.id))

  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.permissionModeTitle')}</div>
      {visible.map((option) => {
        const active = option.id === activeMode
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? `${option.activeBg} text-foreground` : `text-foreground ${option.hoverBg}`
            }`}
          >
            <div className={`flex items-center gap-1.5 font-medium ${option.color}`}>
              {option.icon}
              {t(`chat.cursorPermissionModes.${option.labelKey}.label`)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t(`chat.cursorPermissionModes.${option.descriptionKey}.description`)}
            </div>
          </button>
        )
      })}
    </>
  )
}
