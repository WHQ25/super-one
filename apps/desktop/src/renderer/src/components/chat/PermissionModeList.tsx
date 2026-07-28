import { Shield, FastForward, ShieldOff, PenLine, Zap, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import type { AutoModeEligibility } from '@/lib/auto-mode-eligibility'

/** Ordered list of permission modes — used for cycling via Shift+Tab.
 *  bypassPermissions and dontAsk are intentionally excluded: they are reachable
 *  only by explicit click to raise the operational friction for high-risk modes. */
export const PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'auto', 'acceptEdits']

export interface PermissionModeDescriptor {
  id: PermissionMode
  label: string
  description: string
  icon: React.ReactNode
  color: string
  hoverBg: string
  activeBg: string
}

export const modes: PermissionModeDescriptor[] = [
  {
    id: 'default',
    label: 'Normal',
    description: 'Prompts for dangerous operations',
    icon: <Shield className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'plan',
    label: 'Plan Mode',
    description: 'Planning only, no actual execution',
    icon: <PenLine className="size-3" />,
    color: 'text-blue-600 dark:text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
    activeBg: 'bg-blue-500/15',
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Model classifier decides each permission',
    icon: <Zap className="size-3" />,
    color: 'text-amber-500 dark:text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
    activeBg: 'bg-amber-500/15',
  },
  {
    id: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-accept file edit operations',
    icon: <FastForward className="size-3" />,
    color: 'text-purple-600 dark:text-purple-400',
    hoverBg: 'hover:bg-purple-500/10',
    activeBg: 'bg-purple-500/15',
  },
  {
    id: 'dontAsk',
    label: "Don't Ask",
    description: 'Deny anything not pre-approved',
    icon: <Lock className="size-3" />,
    color: 'text-orange-500 dark:text-orange-400',
    hoverBg: 'hover:bg-orange-500/10',
    activeBg: 'bg-orange-500/15',
  },
  {
    id: 'bypassPermissions',
    label: 'Bypass',
    description: 'Bypass all permission checks',
    icon: <ShieldOff className="size-3" />,
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
    activeBg: 'bg-destructive/15',
  },
]

interface PermissionModeListProps {
  activeMode: PermissionMode
  availableModes?: PermissionMode[]
  autoEligibility?: AutoModeEligibility
  onSelect: (mode: PermissionMode) => void
}

export function PermissionModeList({ activeMode, availableModes, autoEligibility, onSelect }: PermissionModeListProps) {
  const { t } = useTranslation()
  const visibleModes = availableModes ? modes.filter((mode) => availableModes.includes(mode.id)) : modes
  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.permissionModeTitle')}</div>
      {visibleModes.map((mode) => {
        const isAutoBlocked = mode.id === 'auto' && autoEligibility?.ok !== true
        const label = t(`chat.permissionModes.${mode.id}.label`)
        const description = isAutoBlocked
          ? autoEligibility?.message ?? t(`chat.permissionModes.${mode.id}.description`)
          : t(`chat.permissionModes.${mode.id}.description`)
        const active = mode.id === activeMode
        const showDivider = mode.id === 'dontAsk'
        return (
          <div key={mode.id}>
            {showDivider && <div className="my-1 border-t border-border/60" />}
            <button
              disabled={isAutoBlocked}
              title={isAutoBlocked ? description : undefined}
              onClick={() => {
                if (isAutoBlocked) return
                onSelect(mode.id)
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                active
                  ? `${mode.activeBg} text-foreground`
                  : `text-foreground ${mode.hoverBg}`
              } ${isAutoBlocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
            >
              <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                {mode.icon}
                {label}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
            </button>
          </div>
        )
      })}
    </>
  )
}
