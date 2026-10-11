import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * The draft as one string, the way prompt scans (keywords, links) see the sent prompt:
 * paragraphs and hard breaks are newlines, a chip is one non-word character.
 * `positions[i]` is the document position of `text[i]`, or -1 off the text.
 */
export function draftText(doc: PMNode): { text: string; positions: number[] } {
  let text = ''
  const positions: number[] = []
  doc.forEach((block, blockOffset) => {
    if (text) { text += '\n'; positions.push(-1) }
    block.forEach((child, childOffset) => {
      const pos = blockOffset + 1 + childOffset
      if (child.isText && child.text) {
        text += child.text
        for (let i = 0; i < child.text.length; i++) positions.push(pos + i)
      } else {
        text += child.type.name === 'hardBreak' ? '\n' : '￼'
        positions.push(-1)
      }
    })
  })
  return { text, positions }
}
