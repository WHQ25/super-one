import type { AgentEvent, TodoItem } from './agent-types'
import { uiToolNameFromId } from './tool-ui'

type TodosUpdated = Extract<AgentEvent, { type: 'todos_updated' }>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function todoStatus(value: unknown): TodoItem['status'] {
  const status = typeof value === 'string' ? value : ''
  if (status === 'in_progress' || status === 'in-progress') return 'in_progress'
  if (status === 'completed' || status === 'cancelled' || status === 'canceled') return 'completed'
  return 'pending'
}

function todoItemFromRow(row: unknown, index: number, idHint?: string): TodoItem | null {
  const fields = record(row)
  if (!fields) return null
  const subject = String(fields.content ?? fields.subject ?? '').trim()
  if (!subject) return null
  const status = todoStatus(fields.status)
  const id = String(fields.id ?? idHint ?? index + 1)
  return {
    id,
    subject,
    description: String(fields.description ?? ''),
    status,
    ...(status === 'in_progress' ? { activeForm: String(fields.activeForm ?? subject) } : {}),
  }
}

/** Rows from an ACP plan entry or a `todo_write` argument. `[]` clears the list; a non-array is absent. */
export function acpTodoItems(rows: unknown): TodoItem[] | null {
  if (!Array.isArray(rows)) return null
  const items: TodoItem[] = []
  rows.forEach((row, index) => {
    const item = todoItemFromRow(row, index)
    if (item) items.push(item)
  })
  return items
}

/**
 * The list Grok returns after `todo_write` merges by id.
 * Shape: `{ type: "Todo", TodosUpdated: { state: { todos: { [id]: item } } } }`.
 */
export function grokTodoItemsFromOutput(raw: unknown): TodoItem[] | null {
  const root = record(raw)
  const body = root ? record(root.TodosUpdated) : null
  if (!root || root.type !== 'Todo' || !body) return null
  const stateTodos = record(record(body.state)?.todos)
  if (stateTodos) {
    const items: TodoItem[] = []
    Object.entries(stateTodos).forEach(([id, row], index) => {
      const item = todoItemFromRow(row, index, id)
      if (item) items.push(item)
    })
    return items
  }
  return Array.isArray(body.todos) ? acpTodoItems(body.todos) : null
}

export function todosUpdatedEvent(todos: TodoItem[]): TodosUpdated {
  return { type: 'todos_updated', todos }
}

/**
 * Session list for a finished ACP todo call. The tool result is the merged
 * snapshot; the call input is the fallback when that snapshot is absent.
 */
export function todosUpdatedFromAcpTool(input: {
  toolName?: string | null
  status?: string | null
  rawOutput?: unknown
  todos?: unknown
}): TodosUpdated | null {
  if (input.status !== 'completed') return null
  const fromOutput = grokTodoItemsFromOutput(input.rawOutput)
  if (fromOutput) return todosUpdatedEvent(fromOutput)
  const toolName = input.toolName ?? ''
  if (toolName !== 'TodoWrite' && uiToolNameFromId(toolName) !== 'TodoWrite') return null
  const fromInput = acpTodoItems(input.todos)
  if (!fromInput) return null
  // A merge call can name only ids. Dropping those rows must not clear the list.
  if (fromInput.length === 0 && Array.isArray(input.todos) && input.todos.length > 0) return null
  return todosUpdatedEvent(fromInput)
}
