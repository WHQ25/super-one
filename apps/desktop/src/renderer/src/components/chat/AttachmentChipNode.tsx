import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useActiveSession } from '@/stores/chat'
import { AttachmentChipPresenter } from '@superone/chat-view/presenters/AttachmentChip'
import { retryOriginal, useOriginalUploads } from './attachment-originals'
import type { AttachmentNodeAttrs } from './attachment-node'

export function AttachmentChipNode({ node }: NodeViewProps) {
  const { id } = node.attrs as AttachmentNodeAttrs
  const att = useActiveSession((s) => s.attachments.find((a) => a.id === id))
  const originalPath = att?.originalPath
  const status = useOriginalUploads((s) => (originalPath ? s.statuses[originalPath] : undefined))

  // The attachment was removed from the store (e.g. reconciled away) but the node
  // lingers for a frame — render nothing rather than a broken chip.
  if (!att) return <NodeViewWrapper as="span" contentEditable={false} />

  return (
    <NodeViewWrapper as="span" contentEditable={false} data-attachment="" className="select-none">
      <AttachmentChipPresenter
        att={att}
        original={originalPath ? {
          status,
          onRetry: () => void retryOriginal(originalPath),
        } : undefined}
      />
    </NodeViewWrapper>
  )
}
