/**
 * TipTap / ProseMirror paragraph JSON for plain text.
 * Newlines become hardBreak nodes — a text node cannot contain `\n`.
 */
export type TiptapInlineNode =
  | { type: 'text'; text: string }
  | { type: 'hardBreak' }

/**
 * Split plain text into inline nodes for a single TipTap paragraph.
 */
export function plainTextToTiptapParagraphContent(value: string): TiptapInlineNode[] {
  const lines = value.split(/\r?\n/)
  const content: TiptapInlineNode[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) content.push({ type: 'text', text: lines[i]! })
    if (i < lines.length - 1) content.push({ type: 'hardBreak' })
  }
  return content
}

/**
 * Full doc JSON so `setContent` can load multi-line plain text.
 */
export function plainTextToTiptapDoc(value: string): {
  type: 'doc'
  content: Array<{ type: 'paragraph'; content: TiptapInlineNode[] }>
} {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: plainTextToTiptapParagraphContent(value) }],
  }
}
