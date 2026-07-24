import { describe, expect, it } from 'vitest'
import type { PerSessionState } from '../types'
import { reduceTodosUpdated } from './todos'

describe('reduceTodosUpdated', () => {
  it('replaces the OpenCode todo snapshot and opens the todo panel', () => {
    const patch = reduceTodosUpdated({ _todosUserDismissed: false } as PerSessionState, {
      type: 'todos_updated',
      todos: [
        { id: '1', subject: 'Inspect', description: '', status: 'in_progress' },
        { id: '2', subject: 'Fix', description: '', status: 'pending' },
      ],
    })

    expect(patch.todos).toEqual({
      '1': { id: '1', subject: 'Inspect', description: '', status: 'in_progress' },
      '2': { id: '2', subject: 'Fix', description: '', status: 'pending' },
    })
    expect(patch.showTodos).toBe(true)
    expect(patch._nextTodoId).toBe(3)
  })
})
