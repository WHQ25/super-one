export type ComposerCursor = { start: number; end: number }

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
