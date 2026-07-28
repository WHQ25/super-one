import type { ChatMessage, CodexTodoListItem, CodexThreadItem } from '@superone/shared/agent-types'

/**
 * Map a single Codex thread item to the session's "open todo list" field.
 * - undefined: not a todo_list (leave prior value)
 * - null: todo_list exists but every item is completed (hide popup)
 * - item: open list to show
 */
export function codexTodoListFromItem(item: CodexThreadItem): CodexTodoListItem | null | undefined {
  if (item.type !== 'todo_list') return undefined
  const todo = item as CodexTodoListItem
  if (todo.items.length > 0 && todo.items.every((i) => i.completed)) return null
  return todo
}

/**
 * Derive the latest open Codex todo_list by scanning messages newest-first.
 * Used on hydration / persistence merge so TodoPopup does not need a live scan.
 */
export function latestCodexTodoListFromMessages(messages: readonly ChatMessage[]): CodexTodoListItem | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const items = messages[messageIndex].metadata?.codex?.items
    if (!items) continue
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex--) {
      const derived = codexTodoListFromItem(items[itemIndex])
      if (derived === undefined) continue
      return derived
    }
  }
  return null
}
