import type { ReactNode } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { staticMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MentionChipBody } from '@superone/ui/components/ui/MentionChipBody'
import { isStoredCapabilityId } from '@superone/shared/capability-prompt-tags'
import { AgentProfileIcon } from '@superone/ui/components/harness/AgentProfileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import type { MentionNodeAttrs } from './mention-node'

/**
 * Chips that carry a human label rather than a path: they render "blended"
 * (no resource border) and show `displayName`, never the raw value. Shared so
 * the composer NodeView and the sent-bubble chip cannot disagree — they did,
 * and an @agent chip rendered as `codex-base` in the bubble.
 */
export function isBlendedMentionKind(kind: string): boolean {
  return (
    isStoredCapabilityId(kind)
    || kind === 'desktop-app'
    || kind === 'session'
    || kind === 'git'
    || kind === 'agent-profile'
  )
}

/**
 * Shared shell for composer + bubble mention chips.
 * Bubble: parent .user-text-with-mentions is normal inline flow.
 * Composer: .mention-chip uses vertical-align: baseline in the paragraph.
 */
export function MentionChipContent({
  blended,
  kind,
  icon,
  label,
  className,
}: {
  blended: boolean
  kind?: string
  icon: ReactNode
  label: string
  className?: string
}) {
  return (
    <span
      data-mention-kind={kind}
      className={cn(
        'mention-chip select-none',
        blended ? 'mention-chip--blended' : 'mention-chip--resource',
        className,
      )}
    >
      <MentionChipBody icon={icon} label={label} />
    </span>
  )
}

export function mentionChipIcon(
  kind: MentionNodeAttrs['kind'] | string,
  value: string,
  displayName: string,
): ReactNode {
  if (kind === 'agent-profile') return <AgentProfileIcon refValue={value} />
  const staticIcon = staticMentionIcon(kind, value)
  if (staticIcon) return staticIcon
  if (kind === 'miniapp') return <MiniAppIcon appId={value} />
  if (kind === 'desktop-app') return <DesktopAppIcon bundleId={value} />
  // width/height attrs are overridden by .mention-chip__icon > svg { 100% }.
  return <FileIcon name={displayName} size={16} />
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  const isBlendedChip = isBlendedMentionKind(kind)
  const label = kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop()! : displayName

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention=""
      data-mention-kind={kind}
      className={cn(
        'mention-chip select-none',
        isBlendedChip ? 'mention-chip--blended' : 'mention-chip--resource',
      )}
    >
      <MentionChipBody icon={mentionChipIcon(kind, value, displayName)} label={label} />
    </NodeViewWrapper>
  )
}
