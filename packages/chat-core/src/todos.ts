import type { AgentEvent, ChatMessage, TodoItem } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

type TodosUpdatedEvent = Extract<AgentEvent, { type: 'todos_updated' }>

export function reduceTodosUpdated(session: ChatCoreSession, event: TodosUpdatedEvent): Partial<ChatCoreSession> {
  const todos = Object.fromEntries(event.todos.map((todo): [string, TodoItem] => [todo.id, todo]))
  return {
    todos,
    _nextTodoId: event.todos.length + 1,
    ...(!session._todosUserDismissed && { showTodos: event.todos.length > 0 }),
  }
}

/** The list a `TodoWrite` call sets, keyed by position; null when the input carries none. */
export function todoWriteTodos(input: { todos?: unknown }): Record<string, TodoItem> | null {
  if (!Array.isArray(input.todos)) return null
  return Object.fromEntries(input.todos.map((todo: Record<string, unknown>, index): [string, TodoItem] => {
    const id = String(index + 1)
    return [id, {
      id,
      subject: String(todo.content ?? todo.subject ?? ''),
      description: String(todo.description ?? ''),
      status: (todo.status as TodoItem['status']) ?? 'pending',
      activeForm: todo.activeForm as string | undefined,
    }]
  }))
}

/** Replace the session's list, opening the panel unless the user put it away. */
export function todoListUpdate(session: Pick<ChatCoreSession, '_todosUserDismissed'>, todos: Record<string, TodoItem>): Partial<ChatCoreSession> {
  return { todos, _nextTodoId: Object.keys(todos).length + 1, ...(!session._todosUserDismissed && { showTodos: true }) }
}

const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

/**
 * The open list a cold restore brings back: the latest todo call's list when it
 * was a whole-list `TodoWrite` and not every todo is done. Task tools build a
 * list across calls, which a restore cannot replay.
 */
/**
 * Cold host snapshot for a phone that missed live `todos_updated` events.
 * A replayed update wins, including a clear, so an older TodoWrite cannot bring the list back.
 */
export function withTranscriptTodos(
  state: ChatCoreSession,
  messages: readonly ChatMessage[],
  replayedTodosUpdated: boolean,
): ChatCoreSession {
  if (replayedTodosUpdated) return state
  const restored = restoredTodos(messages)
  if (!restored) return state
  return { ...state, ...todoListUpdate(state, restored) }
}

/**
 * The newest todo tool in one message. A later `TaskCreate` / `TaskUpdate`
 * clears a cold restore; only an open `TodoWrite` list comes back.
 * `found` is false when the message has no todo tool, so a search can continue.
 */
export function todoRestoreDecision(message: ChatMessage): { found: true; todos: Record<string, TodoItem> | null } | { found: false } {
  const content = message.content
  for (let b = content.length - 1; b >= 0; b--) {
    const block = content[b]!
    if (block.type !== 'tool_use' || !TODO_TOOLS.has(block.toolName)) continue
    if (block.toolName !== 'TodoWrite') return { found: true, todos: null }
    let todos: Record<string, TodoItem> | null = null
    try { todos = todoWriteTodos(JSON.parse(block.input)) } catch { return { found: true, todos: null } }
    return { found: true, todos: todos && Object.values(todos).some(todo => todo.status !== 'completed') ? todos : null }
  }
  return { found: false }
}

export function restoredTodos(messages: readonly ChatMessage[]): Record<string, TodoItem> | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const decision = todoRestoreDecision(messages[m]!)
    if (decision.found) return decision.todos
  }
  return null
}
