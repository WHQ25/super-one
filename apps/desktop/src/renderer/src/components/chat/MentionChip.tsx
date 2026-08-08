import type { ReactNode } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Bot, Folder, Globe, MousePointer2, Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import type { MentionNodeAttrs } from './mention-node'

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
  label: ReactNode
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
      <span className="mention-chip__icon" aria-hidden>
        {icon}
      </span>
      <span className="mention-chip__label">{label}</span>
    </span>
  )
}

function CapabilityIcon({ kind }: { kind: MentionNodeAttrs['kind'] }) {
  if (kind === 'collab') return <Users className="text-violet-600 dark:text-violet-400" />
  // Match Settings / ComputerUseToolBlock branding (pointer, not monitor).
  if (kind === 'computer') return <MousePointer2 className="text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="text-sky-600 dark:text-sky-400" />
  return null
}

export function mentionChipIcon(
  kind: MentionNodeAttrs['kind'] | string,
  value: string,
  displayName: string,
): ReactNode {
  if (kind === 'agent') return <Bot className="text-purple-600 dark:text-purple-400" />
  if (kind === 'directory') return <Folder className="text-blue-600 dark:text-blue-400" />
  if (kind === 'miniapp') return <MiniAppIcon appId={value} />
  if (kind === 'desktop-app') return <DesktopAppIcon bundleId={value} />
  if (kind === 'collab' || kind === 'computer' || kind === 'browser') {
    return <CapabilityIcon kind={kind} />
  }
  // width/height attrs are overridden by .mention-chip__icon > svg { 100% }.
  return <FileIcon name={displayName} size={16} />
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  const isCapability = kind === 'collab' || kind === 'computer' || kind === 'browser'
  const isBlendedChip = isCapability || kind === 'desktop-app'
  const label = kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop() : displayName
  // Only path-like resource names truncate; multi-word capability labels must show fully.
  const truncateLabel = kind === 'file' || kind === 'directory' || kind === 'miniapp'

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
      <span className="mention-chip__icon" aria-hidden>
        {mentionChipIcon(kind, value, displayName)}
      </span>
      <span className={cn('mention-chip__label', truncateLabel && 'max-w-30 truncate')}>
        {label}
      </span>
    </NodeViewWrapper>
  )
}
