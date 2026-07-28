import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Bot, Folder, X } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import type { MentionNodeAttrs } from './mention-node'

export function MentionChip({ node, getPos, editor }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos()
    if (pos != null) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    }
  }

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention=""
      className="inline-flex items-center gap-1 rounded bg-muted mx-0.5 px-1.5 py-0.5 text-xs leading-none text-foreground select-none whitespace-nowrap align-middle"
    >
      {kind === 'agent' ? (
        <Bot className="size-3 shrink-0 text-purple-600 dark:text-purple-400" />
      ) : kind === 'directory' ? (
        <Folder className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
      ) : kind === 'miniapp' ? (
        <MiniAppIcon appId={value} className="size-3 shrink-0" />
      ) : (
        <FileIcon name={displayName} size={12} />
      )}
      <span className="max-w-30 truncate">
        {kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop() : displayName}
      </span>
      <button
        onMouseDown={handleRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        contentEditable={false}
      >
        <X className="size-2.5" />
      </button>
    </NodeViewWrapper>
  )
}
