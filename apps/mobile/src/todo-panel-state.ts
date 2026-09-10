import type { TodoItem } from '@superone/shared/agent-types'

export interface TodoPanelRow {
  id: string
  /** What the row shows: a running todo speaks in its active form. */
  text: string
  status: TodoItem['status']
  description?: string
  owner?: string
  /** Unfinished todos gating this one, deduped across both edge directions. */
  blockers: string[]
  /**
   * A running todo's description is its live commentary, so it stays open.
   * Any other description is detail the row hides behind a chevron.
   */
  autoDescription: boolean
  expandable: boolean
}

export interface TodoPanelSummary {
  completed: number
  total: number
  hasInProgress: boolean
}

/**
 * Flatten the session's todo map into the rows desktop and Flutter both render.
 *
 * The dependency graph arrives split in two: a todo names what blocks it
 * (`blockedBy`) *and* what it blocks (`blocks`). A row has to show every gate on
 * it, so the `blocks` edges are inverted and merged in — reading only
 * `blockedBy` silently drops half the graph. Completed and unknown blockers are
 * dropped: a finished gate is no longer a gate.
 */
export function buildTodoPanelRows(todos: Record<string, TodoItem>): TodoPanelRow[] {
  const inverseBlockers: Record<string, string[]> = {}
  for (const todo of Object.values(todos)) {
    for (const blockedId of todo.blocks ?? []) {
      (inverseBlockers[blockedId] ??= []).push(todo.id)
    }
  }
  return Object.values(todos).map((todo) => {
    const running = todo.status === 'in_progress'
    const description = todo.description || undefined
    const autoDescription = Boolean(running && description)
    return {
      id: todo.id,
      text: running && todo.activeForm ? todo.activeForm : todo.subject,
      status: todo.status,
      description,
      owner: todo.owner || undefined,
      blockers: Array.from(new Set([...(todo.blockedBy ?? []), ...(inverseBlockers[todo.id] ?? [])]))
        .filter((blockerId) => todos[blockerId] && todos[blockerId].status !== 'completed'),
      autoDescription,
      expandable: Boolean(description) && !autoDescription,
    }
  })
}

export function todoPanelSummary(rows: TodoPanelRow[]): TodoPanelSummary {
  return {
    completed: rows.filter((row) => row.status === 'completed').length,
    total: rows.length,
    hasInProgress: rows.some((row) => row.status === 'in_progress'),
  }
}
