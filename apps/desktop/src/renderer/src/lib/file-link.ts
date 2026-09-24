export * from '@superone/chat-view/presenters/file-link'

/**
 * Whether a click ended on an active text selection — the drag-to-select guard
 * for file chips. Stays here rather than in the shared presenter: it reads the
 * document's selection singleton, which the presenter boundary forbids.
 */
export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}

/** Whether a right-click here opens the selection menu, which then owns the event over nested menus. */
export function hasTextSelection(): boolean {
  return (window.getSelection()?.toString().trim() ?? '').length > 0
}
