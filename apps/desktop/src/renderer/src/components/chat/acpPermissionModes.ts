import type { PermissionMode } from '@superone/shared/agent-types'

/**
 * Grok ACP permission baselines SuperOne can drive over the wire:
 * - default → ask
 * - auto → autoMode
 * - bypassPermissions → yolo / always-approve
 *
 * Labels/icons live in AcpPermissionSelector so this module stays free of JSX
 * (shared with cyclePermissionMode in the chat store).
 */
export const ACP_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'auto',
  'bypassPermissions',
]

export type AcpPermissionModeId = (typeof ACP_PERMISSION_MODES)[number]

export type AcpPermissionLabelKey = 'ask' | 'auto' | 'alwaysApprove'

export interface AcpPermissionModeMeta {
  id: AcpPermissionModeId
  labelKey: AcpPermissionLabelKey
  color: string
  hoverBg: string
  activeBg: string
}

/** Style tokens only — same vocabulary as Claude/Codex status-bar selectors. */
export const ACP_PERMISSION_MODE_META: AcpPermissionModeMeta[] = [
  {
    id: 'default',
    labelKey: 'ask',
    color: 'text-muted-foreground',
    hoverBg: 'hover:bg-accent',
    activeBg: 'bg-accent',
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
