import type { ReactNode } from 'react'
import { Eye, ShieldCheck, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import { DEEPSEEK_PERMISSION_MODE_META, type DeepseekPermissionModeMeta } from './deepseekPermissionModes'

export type DeepseekPermissionModeOption = DeepseekPermissionModeMeta & {
  icon: ReactNode
  color: string
  hoverBg: string
  activeBg: string
}

/**
 * dsh presets rather than SuperOne's generic mode names, because the preset is
 * what happens: it decides the sandbox the shell and filesystem run under, not
 * only whether a popover appears. Reusing `PermissionModeList` would label
 * `read-only` as "Plan Mode", which dsh does not have.
 */
const TONE: Record<DeepseekPermissionModeMeta['preset'], Omit<DeepseekPermissionModeOption, keyof DeepseekPermissionModeMeta>> = {
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

export const deepseekPermissionModeOptions: DeepseekPermissionModeOption[] =
  DEEPSEEK_PERMISSION_MODE_META.map((meta) => ({ ...meta, ...TONE[meta.preset] }))

export function deepseekPermissionModeOption(mode: PermissionMode): DeepseekPermissionModeOption {
  return deepseekPermissionModeOptions.find((option) => option.mode === mode) ?? deepseekPermissionModeOptions[1]
}

export function DeepseekPermissionModeList({
  activeMode,
  onSelect,
}: {
  activeMode: PermissionMode
  onSelect: (mode: PermissionMode) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.permissionModeTitle')}</div>
      {deepseekPermissionModeOptions.map((option) => {
        const active = option.mode === activeMode
        return (
          <button
            key={option.mode}
            onClick={() => onSelect(option.mode)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? `${option.activeBg} text-foreground` : `text-foreground ${option.hoverBg}`
            }`}
          >
            <div className={`flex items-center gap-1.5 font-medium ${option.color}`}>
              {option.icon}
              {t(option.labelKey)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t(option.descriptionKey)}</div>
          </button>
        )
      })}
    </>
  )
}
