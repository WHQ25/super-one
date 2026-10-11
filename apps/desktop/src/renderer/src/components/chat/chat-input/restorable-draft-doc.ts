import type { JSONContent } from '@tiptap/react'
import { liftBlockPasteChips } from '../paste-chip-node'

/**
 * Marks the composer once produced through StarterKit's Link and Underline
 * extensions. Saved drafts can carry them, and a mark the schema lacks makes
 * TipTap discard the whole document. URLs are now drawn by `WebLinkDecoration`.
 */
const RETIRED_MARKS = new Set(['link', 'underline'])

function dropRetiredMarks(node: JSONContent): JSONContent {
  const marks = node.marks?.filter((mark) => !RETIRED_MARKS.has(mark.type))
  const { marks: _marks, ...rest } = node
  return {
    ...rest,
    ...(marks?.length ? { marks } : {}),
    ...(node.content ? { content: node.content.map(dropRetiredMarks) } : {}),
  }
}

/** A saved draft document in the shape the current composer schema accepts. */
export function restorableDraftDoc(doc: JSONContent): JSONContent {
  return dropRetiredMarks(liftBlockPasteChips(doc))
}
