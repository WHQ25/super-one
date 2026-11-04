import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import type { PermissionMode } from '@superone/shared/agent-types'

export const ACP_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'auto',
  'bypassPermissions',
]

export const ANTIGRAVITY_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
]

export function acpPermissionModesForAgent(agentId?: string | null): PermissionMode[] {
  return isAntigravityAcpAgent(agentId) ? ANTIGRAVITY_PERMISSION_MODES : ACP_PERMISSION_MODES
}

export type AcpPermissionModeId = PermissionMode

export type AcpPermissionLabelKey =
  | 'ask'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'antigravityAuto'
  | 'alwaysApprove'

export interface AcpPermissionModeMeta {
  id: AcpPermissionModeId
  labelKey: AcpPermissionLabelKey
  color: string
  hoverBg: string
  activeBg: string
}

export const ACP_PERMISSION_MODE_META: AcpPermissionModeMeta[] = [
  {
    id: 'default',
    labelKey: 'ask',
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'plan',
    labelKey: 'plan',
    color: 'text-blue-500 dark:text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
    activeBg: 'bg-blue-500/15',
  },
  {
    id: 'auto',
    labelKey: 'auto',
    color: 'text-amber-500 dark:text-amber-400',
    hoverBg: 'hover:bg-amber-500/10',
    activeBg: 'bg-amber-500/15',
  },
  {
    id: 'bypassPermissions',
    labelKey: 'alwaysApprove',
    color: 'text-destructive',
    hoverBg: 'hover:bg-destructive/10',
    activeBg: 'bg-destructive/15',
  },
]

export const ANTIGRAVITY_PERMISSION_MODE_META: AcpPermissionModeMeta[] = [
  {
    id: 'default',
    labelKey: 'ask',
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
  },
  {
    id: 'plan',
    labelKey: 'plan',
    color: 'text-purple-500 dark:text-purple-400',
    hoverBg: 'hover:bg-purple-500/10',
    activeBg: 'bg-purple-500/15',
  },
  {
    id: 'acceptEdits',
    labelKey: 'acceptEdits',
    color: 'text-lime-600 dark:text-lime-400',
    hoverBg: 'hover:bg-lime-500/10',
    activeBg: 'bg-lime-500/15',
  },
  {
    id: 'auto',
    labelKey: 'antigravityAuto',
    color: 'text-orange-500 dark:text-orange-400',
    hoverBg: 'hover:bg-orange-500/10',
    activeBg: 'bg-orange-500/15',
  },
]
