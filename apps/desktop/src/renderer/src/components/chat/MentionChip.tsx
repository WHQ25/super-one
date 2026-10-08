import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { MentionChipBody } from '@superone/ui/components/ui/MentionChipBody'
import { MentionChipIcon } from '@superone/chat-view/presenters/UserText'
import { McpMentionPreviewHover } from './McpMentionSent'
import type { MentionNodeAttrs } from './mention-node'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { absoluteFilePath, useFileChipActions } from './file-chip-context-menu'
import { useFileDragProps } from './DraggableFileIcon'
import { hasTextSelection } from '@/lib/file-link'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'

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
        <MentionChipBody icon={<MentionChipIcon kind="file" value={value} label={label} />} label={label} iconProps={iconProps} />
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
          <MentionChipBody icon={<MentionChipIcon kind={kind} value={value} label={displayName} />} label={label} />
        </McpMentionPreviewHover>
      ) : (
        <MentionChipBody icon={<MentionChipIcon kind={kind} value={value} label={displayName} />} label={label} />
      )}
    </NodeViewWrapper>
  )
}
