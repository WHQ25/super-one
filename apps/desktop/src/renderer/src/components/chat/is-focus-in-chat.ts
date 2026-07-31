/**
 * Whether keyboard focus is currently inside a chat pane.
 *
 * Chat permission / confirm prompts attach window-level keydown listeners
 * (digit shortcuts, Enter approve, Escape deny, …). Those must no-op when the
 * user is typing or navigating in another surface (file editor, terminal,
 * activity panel, browser chrome, …). ChatContent roots are marked with
 * `data-chat-root`.
 */
export function isFocusInChat(active: Element | null = document.activeElement): boolean {
  return active instanceof Element && active.closest('[data-chat-root]') != null
}
