import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { PasteChipView } from './PasteChipView'

export const PASTE_CHIP_LINE_THRESHOLD = 10
export const PASTE_CHIP_CHAR_THRESHOLD = 500

export const PasteChipNode = Node.create({
  name: 'pasteChip',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      text: { default: '' },
      lineCount: { default: 0 },
      preview: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-paste-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-paste-chip': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PasteChipView, { as: 'div', className: 'paste-chip-wrapper' })
  },
})
