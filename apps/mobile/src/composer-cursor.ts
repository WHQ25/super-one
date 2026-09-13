export type ComposerCursor = { start: number; end: number }

/** Insert at the caret (or replace the selection) and park the caret after it. */
export function insertAtCursor(draft: string, cursor: ComposerCursor, snippet: string): {
  draft: string
  cursor: ComposerCursor
} {
  const start = Math.max(0, Math.min(cursor.start, draft.length))
  const end = Math.max(start, Math.min(cursor.end, draft.length))
  const next = draft.slice(0, start) + snippet + draft.slice(end)
  const caret = start + snippet.length
  return { draft: next, cursor: { start: caret, end: caret } }
}

/** Native text events can precede selection events. Infer the end of the edit,
 * retaining the previous caret when repeated characters make the diff ambiguous. */
export function cursorAfterEdit(before: string, after: string, selection: ComposerCursor): ComposerCursor {
  const inserted = after.length - before.length + selection.end - selection.start
  if (inserted >= 0 && after.slice(0, selection.start) === before.slice(0, selection.start)
    && after.slice(selection.start + inserted) === before.slice(selection.end)) {
    const end = selection.start + inserted
    return { start: end, end }
  }
  let suffix = 0
  while (suffix < before.length && suffix < after.length
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const end = after.length - suffix
  return { start: end, end }
}

/**
 * The toolbar's `@` / `/` is a request to open the overlay, not a character.
 * A mention needs a word boundary before it — `foo@bar` is an email, not a
 * query — so a trigger placed right after text is separated from it first.
 */
export function triggerSnippet(draft: string, cursor: ComposerCursor, trigger: string): string {
  const start = Math.max(0, Math.min(cursor.start, draft.length))
  const before = start > 0 ? draft[start - 1]! : ''
  return before && !/\s/.test(before) ? ` ${trigger}` : trigger
}
