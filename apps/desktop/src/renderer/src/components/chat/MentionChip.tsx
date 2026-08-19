import type { ReactNode } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Bot, Bug, Folder, Globe, LayoutDashboard, MessageSquare, MousePointer2, Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { isStoredCapabilityId } from '@superone/shared/capability-prompt-tags'
import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import { resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
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

function CapabilityIcon({ kind }: { kind: string }) {
  if (kind === 'collab') return <Users className="text-violet-600 dark:text-violet-400" />
  // Match Settings / ComputerUseToolBlock branding (pointer, not monitor).
  if (kind === 'computer') return <MousePointer2 className="text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="text-sky-600 dark:text-sky-400" />
  if (kind === 'widget') return <LayoutDashboard className="text-amber-600 dark:text-amber-400" />
  if (kind === 'debug') return <Bug className="text-rose-600 dark:text-rose-400" />
  return null
}

/**
 * A mentioned agent shows its own brand mark — that is the whole point of
 * `@codex` over `@collab`: you see who you are delegating to.
 */
function AgentProfileIcon({ refValue }: { refValue: string }) {
  const Icon = resolveSessionIconFromBrandKey(brandKeyForAgentRef(refValue))
  if (!Icon) return <Bot className="text-foreground" />
  // Same render as the session title: compact drops the idle float / leg wiggle
  // so a chip sitting in a sentence does not fidget. No `size` — the wrapper is
  // sized by .mention-chip__icon > span, so the mark scales with the text.
  return <Icon status="default" renderLevel="compact" />
}

export function mentionChipIcon(
  kind: MentionNodeAttrs['kind'] | string,
  value: string,
  displayName: string,
): ReactNode {
  if (kind === 'agent-profile') return <AgentProfileIcon refValue={value} />
  if (kind === 'agent') return <Bot className="text-purple-600 dark:text-purple-400" />
  if (kind === 'directory') return <Folder className="text-blue-600 dark:text-blue-400" />
  if (kind === 'miniapp') return <MiniAppIcon appId={value} />
  if (kind === 'desktop-app') return <DesktopAppIcon bundleId={value} />
  // Neutral, matching the sidebar session list: a session is content, not a capability,
  // so it takes no identity hue. text-foreground (not muted) keeps it clear of disabled.
  if (kind === 'session') return <MessageSquare className="text-foreground" />
  if (isStoredCapabilityId(kind)) {
    return <CapabilityIcon kind={kind} />
  }
  // width/height attrs are overridden by .mention-chip__icon > svg { 100% }.
  return <FileIcon name={displayName} size={16} />
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  const isBlendedChip = isBlendedMentionKind(kind)
  const label = kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop() : displayName
  // Only path-like resource names truncate; multi-word capability labels must show fully.
  const truncateLabel = kind === 'file' || kind === 'directory' || kind === 'miniapp' || kind === 'session'

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
