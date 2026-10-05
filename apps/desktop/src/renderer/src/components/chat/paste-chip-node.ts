import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { PasteChipView } from './PasteChipView'

const PASTE_CHIP_LINE_THRESHOLD = 10
const PASTE_CHIP_CHAR_THRESHOLD = 500

/**
 * A message from before pastes were marked (`isPaste`) shows its long text
 * runs as a paste chip; the composer chips every paste.
 */
export function isLongPaste(text: string): boolean {
  return text.split('\n').length >= PASTE_CHIP_LINE_THRESHOLD || text.length >= PASTE_CHIP_CHAR_THRESHOLD
}

export const PasteChipNode = Node.create({
  name: 'pasteChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      text: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-paste-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-paste-chip': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PasteChipView, { as: 'span', className: 'mention-chip-wrapper' })
  },
})

/**
 * Paste chips used to be top-level blocks; saved drafts can still hold them
 * there. Wrap each in a paragraph so the doc fits the inline schema.
 */
export function liftBlockPasteChips(doc: JSONContent): JSONContent {
  if (!doc.content?.some((node) => node.type === 'pasteChip')) return doc
  return {
    ...doc,
    content: doc.content.map((node) => (node.type === 'pasteChip' ? { type: 'paragraph', content: [node] } : node)),
  }
}
