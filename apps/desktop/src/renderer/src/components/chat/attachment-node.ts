import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AttachmentChipNode } from './AttachmentChipNode'

export interface AttachmentNodeAttrs {
  id: string
}

export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-attachment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-attachment': '' }, HTMLAttributes)]
  },

  // Attachments are file references, not text — they contribute nothing to the
  // serialized prompt text. The bytes travel via request.images / message
  // attachments, collected separately from the doc on send.
  renderText() {
    return ''
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentChipNode, { as: 'span', className: 'attachment-chip-wrapper' })
  },
})
