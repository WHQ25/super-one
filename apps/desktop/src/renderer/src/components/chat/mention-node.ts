import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MentionChip } from './MentionChip'

export interface MentionNodeAttrs {
  kind:
    | 'file'
    | 'directory'
    | 'agent'
    | 'miniapp'
    | 'collab'
    | 'computer'
    | 'browser'
    | 'desktop-app'
    | 'session'
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

  renderText({ node }) {
    const attrs = node.attrs as MentionNodeAttrs
    let value = attrs.value
    // Keep directory marker in plain-text serialization so re-parse after send
    // can recover kind:directory (trailing slash is the only durable signal).
    if (attrs.kind === 'directory' && value && !value.endsWith('/')) value += '/'
    return ` @${value} `
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: 'span', className: 'mention-chip-wrapper' })
  },
})
