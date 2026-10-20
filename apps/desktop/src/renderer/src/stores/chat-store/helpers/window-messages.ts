import type { ChatMessage } from '@superone/shared/agent-types'
import { applyTodoResult, type ChatCoreSession } from '@superone/chat-core'

/** A bubble this client painted before the host's window carried it. */
function isClientOnly(message: ChatMessage): boolean {
  return message.providerId === 'local' || message.metadata?.sendFailure != null
}

/**
 * The window's rows, with an unsent local bubble kept after the host row it
 * followed. A host row the window no longer holds is gone: older history loads
 * as its own page.
 */
export function mergeWindowMessages(current: readonly ChatMessage[], windowed: readonly ChatMessage[]): ChatMessage[] {
  const ids = new Set(windowed.map((message) => message.id))
  const local = (message: ChatMessage) => !ids.has(message.id) && isClientOnly(message)
  if (!current.some(local)) return [...windowed]
  const after = new Map<string | null, ChatMessage[]>()
  let anchor: string | null = null
  for (const message of current) {
    if (local(message)) after.set(anchor, [...(after.get(anchor) ?? []), message])
    else if (ids.has(message.id)) anchor = message.id
  }
  return [...windowed.flatMap((message) => [message, ...(after.get(message.id) ?? [])]), ...(after.get(null) ?? [])]
}

/**
 * One live patch: replace the rows it carries and keep every other row object.
 * `order`, when the patch sends it, is the host rows that remain.
 */
export function applyWindowRows(
  current: readonly ChatMessage[],
  rows: readonly ChatMessage[],
  patch: { removed?: readonly string[]; order?: readonly string[] },
): ChatMessage[] {
  const removed = new Set(patch.removed ?? [])
  const updates = new Map(rows.map((message) => [message.id, message]))
  const local = (message: ChatMessage) => !updates.has(message.id) && !removed.has(message.id) && isClientOnly(message)
  if (patch.order) {
    const byId = new Map<string, ChatMessage>()
    for (const message of current) if (!removed.has(message.id)) byId.set(message.id, message)
    for (const row of rows) byId.set(row.id, row)
    const after = new Map<string | null, ChatMessage[]>()
    let anchor: string | null = null
    for (const message of current) {
      if (local(message)) after.set(anchor, [...(after.get(anchor) ?? []), message])
      else if (patch.order.includes(message.id)) anchor = message.id
    }
    return [...patch.order.flatMap((id) => {
      const message = byId.get(id)
      return message ? [message, ...(after.get(id) ?? [])] : []
    }), ...(after.get(null) ?? [])]
  }
  const seen = new Set<string>()
  const next: ChatMessage[] = []
  for (const message of current) {
    if (removed.has(message.id)) continue
    const update = updates.get(message.id)
    if (update) { next.push(update); seen.add(update.id) }
    else next.push(message)
  }
  for (const row of rows) if (!seen.has(row.id) && !removed.has(row.id)) next.push(row)
  return next
}

type TodoSession = Pick<ChatCoreSession, 'todos' | '_nextTodoId' | '_todosUserDismissed'>

/**
 * Todo results that arrived with this window and were not already a
 * `todo_result` on the previous rows. Older pages that scroll into view are
 * left alone: a window is a tail, and an earlier TodoWrite would replace a
 * list built by calls that have scrolled out. Applying the same id again is
 * an upsert, so a result the live delta already recorded is skipped.
 */
export function todoUpdatesFromWindow(
  session: TodoSession,
  previous: readonly ChatMessage[],
  rows: readonly ChatMessage[],
): Partial<ChatCoreSession> | null {
  const seen = new Set<string>()
  for (const message of previous) {
    for (const block of message.content) {
      if (block.type === 'todo_result') seen.add(block.toolUseId)
    }
  }
  if (previous.length === 0) return null
  const known = new Set(previous.map((message) => message.id))
  const firstKnown = rows.findIndex((message) => known.has(message.id))
  // A patch of only new rows is the live tail. An older page sits before the first row already on screen.
  const start = firstKnown < 0 ? 0 : firstKnown
  let current = session
  let patch: Partial<ChatCoreSession> | null = null
  for (const message of rows.slice(start)) {
    for (const block of message.content) {
      if (block.type !== 'todo_result' || seen.has(block.toolUseId) || !block.toolTodos) continue
      const applied = applyTodoResult(current, block)
      if (!applied) continue
      patch = { ...patch, ...applied }
      current = { ...current, todos: applied.todos ?? current.todos, _nextTodoId: applied._nextTodoId ?? current._nextTodoId, _todosUserDismissed: current._todosUserDismissed }
      seen.add(block.toolUseId)
    }
  }
  return patch
}
