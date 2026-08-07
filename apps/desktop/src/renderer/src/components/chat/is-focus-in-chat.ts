import { createContext, useContext, type RefObject } from 'react'

/**
 * Ref to the nearest chat pane root (`[data-chat-root]`). Provided by ChatContent
 * so prompts can scope keyboard shortcuts and autofocus to their own mosaic tile.
 */
export const ChatRootContext = createContext<RefObject<HTMLElement | null> | null>(null)

export function useChatRootRef(): RefObject<HTMLElement | null> | null {
  return useContext(ChatRootContext)
}

/**
 * Whether keyboard focus is currently inside a chat pane.
 *
 * Chat permission / confirm prompts attach window-level keydown listeners
 * (digit shortcuts, Enter approve, Escape deny, …). Those must no-op when the
 * user is typing or navigating in another surface (file editor, terminal,
 * activity panel, browser chrome, …). ChatContent roots are marked with
 * `data-chat-root`.
 *
 * When `root` is provided (the pane that owns the listener), focus must be
 * inside **that** root — so a sibling mosaic tile's prompt does not swallow
 * keys or steal focus from the pane the user is actually typing in.
 * Without `root`, any `[data-chat-root]` counts (legacy / tests without context).
 */
export function isFocusInChat(
  active: Element | null = document.activeElement,
  root?: Element | null,
): boolean {
  if (!(active instanceof Element)) return false
  if (root != null) return root.contains(active)
  return active.closest('[data-chat-root]') != null
}

/**
 * Whether this chat pane may programmatically focus a control (permission
 * buttons, etc.). Returns false when keyboard focus already lives in a
 * different chat root — blocking mosaic cross-pane focus theft — but true
 * when focus is outside every chat (body, terminal, …) so single-pane
 * permission UX is unchanged.
 */
export function canAutofocusInChatRoot(
  root: Element | null | undefined,
  active: Element | null = document.activeElement,
): boolean {
  if (!root) return true
  if (!(active instanceof Element)) return true
  const activeRoot = active.closest('[data-chat-root]')
  if (!activeRoot) return true
  return root.contains(active)
}
