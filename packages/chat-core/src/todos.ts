import type { AgentEvent, TodoItem } from '@superone/shared/agent-types'
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
