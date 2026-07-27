import type { ReactNode } from 'react'
import { ListTodo, MessageCircle, Unlock, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ACP_PERMISSION_MODE_META, type AcpPermissionModeId, type AcpPermissionModeMeta } from './acpPermissionModes'

export type AcpPermissionModeOption = AcpPermissionModeMeta & { icon: ReactNode }

/** Style tokens live in `acpPermissionModes.ts` (JSX-free); icons are attached here. */
export const acpPermissionModeOptions: AcpPermissionModeOption[] = ACP_PERMISSION_MODE_META.map((meta) => ({
  ...meta,
  icon:
    meta.id === 'plan' ? <ListTodo className="size-3" />
    : meta.id === 'auto' ? <Zap className="size-3" />
    : meta.id === 'bypassPermissions' ? <Unlock className="size-3" />
    : <MessageCircle className="size-3" />,
}))

export function acpPermissionModeOption(mode: string): AcpPermissionModeOption {
  return acpPermissionModeOptions.find((option) => option.id === mode) ?? acpPermissionModeOptions[0]
}

export function AcpPermissionModeList({
  activeMode,
  onSelect,
}: {
  activeMode: AcpPermissionModeId
  onSelect: (mode: AcpPermissionModeId) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.acpPermissionModes.title')}</div>
      {acpPermissionModeOptions.map((option) => {
        const selected = option.id === activeMode
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
              selected ? `${option.activeBg} text-foreground` : `text-foreground ${option.hoverBg}`
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
    </>
  )
}
