import { Shield, FastForward, ShieldOff, PenLine, Zap, Lock } from 'lucide-react'
import type { PermissionMode } from '../../../../shared/agent-types'
import type { AutoModeEligibility } from '@/lib/auto-mode-eligibility'

/** Ordered list of permission modes — used for cycling via Shift+Tab.
 *  bypassPermissions and dontAsk are intentionally excluded: they are reachable
 *  only by explicit click to raise the operational friction for high-risk modes. */
export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']

export interface PermissionModeDescriptor {
  id: PermissionMode
  label: string
  description: string
  icon: React.ReactNode
  color: string
  hoverBg: string
}

export const modes: PermissionModeDescriptor[] = [
  {
    id: 'default',
    label: 'Normal',
    description: 'Prompts for dangerous operations',
    icon: <Shield className="size-3" />,
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-muted',
  },
  {
    id: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-accept file edit operations',
    icon: <FastForward className="size-3" />,
    color: 'text-purple-400',
    hoverBg: 'hover:bg-purple-500/10',
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Model classifier decides each permission',
    icon: <Zap className="size-3" />,
    color: 'text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
  },
  {
    id: 'plan',
    label: 'Plan Mode',
    description: 'Planning only, no actual execution',
    icon: <PenLine className="size-3" />,
    color: 'text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
  },
  {
    id: 'dontAsk',
    label: "Don't Ask",
    description: 'Deny anything not pre-approved',
    icon: <Lock className="size-3" />,
    color: 'text-orange-400',
    hoverBg: 'hover:bg-orange-500/10',
  },
  {
    id: 'bypassPermissions',
    label: 'Bypass',
    description: 'Bypass all permission checks',
    icon: <ShieldOff className="size-3" />,
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
  },
]

interface PermissionModeListProps {
  activeMode: PermissionMode
  autoEligibility: AutoModeEligibility
  onSelect: (mode: PermissionMode) => void
}

export function PermissionModeList({ activeMode, autoEligibility, onSelect }: PermissionModeListProps) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">Permission Mode</div>
      {modes.map((mode) => {
        const isAutoBlocked = mode.id === 'auto' && !autoEligibility.ok
        const description = isAutoBlocked ? autoEligibility.message : mode.description
        const active = mode.id === activeMode
        const showDivider = mode.id === 'dontAsk'
        return (
          <div key={mode.id}>
            {showDivider && <div className="my-1 border-t border-border/60" />}
            <button
              disabled={isAutoBlocked}
              title={isAutoBlocked ? autoEligibility.message : undefined}
              onClick={() => {
                if (isAutoBlocked) return
                onSelect(mode.id)
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                active
                  ? 'bg-muted text-foreground'
                  : 'text-foreground hover:bg-muted/50'
              } ${isAutoBlocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
            >
              <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                {mode.icon}
                {mode.label}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>
            </button>
          </div>
        )
      })}
    </>
  )
}
