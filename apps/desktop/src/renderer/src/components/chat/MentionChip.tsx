import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { staticMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { FileChipIcon } from './FileChipIcon'
import { MentionChipBody } from '@superone/ui/components/ui/MentionChipBody'
import { isStoredCapabilityId } from '@superone/shared/capability-prompt-tags'
import { AgentProfileIcon } from '@superone/ui/components/harness/AgentProfileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import { McpMentionChipIcon } from './McpMentionRows'
import { McpMentionPreviewHover } from './McpMentionSent'
import type { MentionNodeAttrs } from './mention-node'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { absoluteFilePath, useFileChipActions } from './file-chip-context-menu'
import { useFileDragProps } from './DraggableFileIcon'
import { hasTextSelection } from '@/lib/file-link'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'

/**
 * Chips that carry a human label rather than a path: they show `displayName`,
 * never the raw value. Shared so the composer NodeView and the sent-bubble chip
 * cannot disagree — they did, and an @agent chip rendered as `codex-base` in
 * the bubble.
 */
export function isLabelMentionKind(kind: string): boolean {
  return (
    isStoredCapabilityId(kind)
    || kind === 'desktop-app'
    || kind === 'session'
    || kind === 'git'
    || kind === 'agent-profile'
    || kind === 'mcp-resource'
  )
}

/**
 * Shared shell for every desktop chat chip (mentions, attachments, pasted
 * text), composer + bubble: `[icon] [label]` in the blended style, no fill.
 * Bubble: parent .user-text-with-mentions is normal inline flow.
 * Composer: .mention-chip uses vertical-align: baseline in the paragraph.
 * Remaining props and `ref` land on the outer span, so a file chip can take its
 * click and Radix `asChild` context-menu trigger; `iconProps` make the icon its drag handle.
 */
export function MentionChipContent({
  kind,
  icon,
  label,
  iconProps,
  className,
  ...rest
}: Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  kind?: string
  icon: ReactNode
  label: string
  iconProps?: ComponentPropsWithoutRef<'span'>
}) {
  return (
    <span
      {...rest}
      data-mention-kind={kind}
      data-selection-fill=""
      className={cn('mention-chip mention-chip--blended select-none', className)}
    >
      <MentionChipBody icon={icon} label={label} iconProps={iconProps} />
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
  if (kind === 'mcp-resource') return <McpMentionChipIcon value={value} />
  if (kind === 'file') return <FileChipIcon name={displayName} filePath={value} />
  // width/height attrs are overridden by .mention-chip__icon > svg { 100% }.
  return <FileIcon name={displayName} size={16} />
}

/**
 * A file mention, in the composer or a sent bubble, acts like FileChip: click
 * opens the file, the icon drags it out, right-click shows the file menu.
 */
export function useFileMentionActions(value: string, label: string) {
  const filePath = absoluteFilePath(value, selectEffectiveProjectRoot(useAppStore.getState()))
  const { dragEndRef, menu, handleClick } = useFileChipActions(filePath)
  const dragProps = useFileDragProps(label, filePath, dragEndRef)
  return {
    menu,
    chipProps: { role: 'button', title: value, onClick: handleClick },
    iconProps: dragProps && { ...dragProps, className: 'cursor-grab active:cursor-grabbing' },
  }
}

function FileMentionNodeView({ value, label }: { value: string; label: string }) {
  const { menu, chipProps, iconProps } = useFileMentionActions(value, label)
  return (
    <AdaptiveContextMenu items={menu.items} onOpen={menu.onOpen} yieldWhen={hasTextSelection}>
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-mention=""
        data-mention-kind="file"
        {...chipProps}
        className="mention-chip mention-chip--blended cursor-pointer select-none"
      >
        <MentionChipBody icon={mentionChipIcon('file', value, label)} label={label} iconProps={iconProps} />
      </NodeViewWrapper>
    </AdaptiveContextMenu>
  )
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  if (kind === 'file') return <FileMentionNodeView value={value} label={displayName} />
  const label = kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop()! : displayName

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention=""
      data-mention-kind={kind}
      className="mention-chip mention-chip--blended select-none"
    >
      {kind === 'mcp-resource' ? (
        <McpMentionPreviewHover value={value}>
          <MentionChipBody icon={mentionChipIcon(kind, value, displayName)} label={label} />
        </McpMentionPreviewHover>
      ) : (
        <MentionChipBody icon={mentionChipIcon(kind, value, displayName)} label={label} />
      )}
    </NodeViewWrapper>
  )
}
