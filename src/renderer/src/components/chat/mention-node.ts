import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MentionChip } from './MentionChip'

export interface MentionNodeAttrs {
  kind: 'file' | 'directory' | 'agent'
  value: string
  displayName: string
}

export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 'file' },
      value: { default: '' },
      displayName: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-mention': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: 'span', className: 'mention-chip-wrapper' })
  },
})
