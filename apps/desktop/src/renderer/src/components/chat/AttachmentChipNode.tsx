import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { useActiveSession } from '@/stores/chat'
import { AttachmentChip, AttachmentPreviewDialog } from './attachment-chip'
import type { AttachmentNodeAttrs } from './attachment-node'

export function AttachmentChipNode({ node, getPos, editor }: NodeViewProps) {
  const { id } = node.attrs as AttachmentNodeAttrs
  const att = useActiveSession((s) => s.attachments.find((a) => a.id === id))
  const [preview, setPreview] = useState(false)

  const handleRemove = (): void => {
    const pos = getPos()
    if (pos != null) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    }
  }

  // The attachment was removed from the store (e.g. reconciled away) but the node
  // lingers for a frame — render nothing rather than a broken chip.
  if (!att) return <NodeViewWrapper as="span" contentEditable={false} />

  return (
    <NodeViewWrapper as="span" contentEditable={false} data-attachment="" className="select-none">
      <TooltipProvider delayDuration={200}>
        <AttachmentChip att={att} onOpen={() => setPreview(true)} onRemove={handleRemove} />
      </TooltipProvider>
      {preview && <AttachmentPreviewDialog attachment={att} onClose={() => setPreview(false)} />}
    </NodeViewWrapper>
  )
}
