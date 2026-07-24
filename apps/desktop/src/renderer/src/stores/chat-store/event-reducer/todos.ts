import type { AgentEvent, TodoItem } from '@superone/shared/agent-types'
import type { PerSessionState } from '../types'

type TodosUpdatedEvent = Extract<AgentEvent, { type: 'todos_updated' }>

export function reduceTodosUpdated(session: PerSessionState, event: TodosUpdatedEvent): Partial<PerSessionState> {
  const todos = Object.fromEntries(event.todos.map((todo): [string, TodoItem] => [todo.id, todo]))
  return {
    todos,
    _nextTodoId: event.todos.length + 1,
    ...(!session._todosUserDismissed && { showTodos: event.todos.length > 0 }),
  }
}
