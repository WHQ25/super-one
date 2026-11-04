import type { ReactNode } from 'react'
import { FastForward, ListTodo, MessageCircle, Unlock, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import {
  ACP_PERMISSION_MODE_META,
  ANTIGRAVITY_PERMISSION_MODE_META,
  type AcpPermissionModeId,
  type AcpPermissionModeMeta,
} from './acpPermissionModes'

export type AcpPermissionModeOption = AcpPermissionModeMeta & { icon: ReactNode }

function withIcon(meta: AcpPermissionModeMeta): AcpPermissionModeOption {
  return {
    ...meta,
    icon:
      meta.id === 'plan' ? <ListTodo className="size-3" />
      : meta.id === 'acceptEdits' ? <FastForward className="size-3" />
      : meta.id === 'auto' ? <Zap className="size-3" />
      : meta.id === 'bypassPermissions' ? <Unlock className="size-3" />
      : <MessageCircle className="size-3" />,
  }
}

export const acpPermissionModeOptions: AcpPermissionModeOption[] =
  ACP_PERMISSION_MODE_META.map(withIcon)

export const antigravityPermissionModeOptions: AcpPermissionModeOption[] =
  ANTIGRAVITY_PERMISSION_MODE_META.map(withIcon)

export function acpPermissionModeOptionsForAgent(agentId?: string | null): AcpPermissionModeOption[] {
  return isAntigravityAcpAgent(agentId) ? antigravityPermissionModeOptions : acpPermissionModeOptions
}

export function acpPermissionModeOption(
  mode: string,
  agentId?: string | null,
): AcpPermissionModeOption {
  const options = acpPermissionModeOptionsForAgent(agentId)
  return options.find((option) => option.id === mode) ?? options[0]!
}

export function AcpPermissionModeList({
  activeMode,
  agentId,
  onSelect,
}: {
  activeMode: AcpPermissionModeId
  agentId?: string | null
  onSelect: (mode: AcpPermissionModeId) => void
}) {
  const { t } = useTranslation()
  const options = acpPermissionModeOptionsForAgent(agentId)
  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.acpPermissionModes.title')}</div>
      {options.map((option) => {
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
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t(`chat.acpPermissionModes.${option.labelKey}.description`)}
            </div>
          </button>
        )
      })}
    </>
  )
}
