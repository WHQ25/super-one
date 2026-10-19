import { describe, expect, it } from 'vitest'
import { acpTodoItems, grokTodoItemsFromOutput, todosUpdatedFromAcpTool } from './acp-todos'

describe('acp todo snapshots', () => {
  it('keeps a plan row id stable and speaks the running line in its active form', () => {
    expect(acpTodoItems([
      { content: 'Explore', status: 'completed' },
      { id: 'ship', content: 'Implement', status: 'in_progress' },
    ])).toEqual([
      { id: '1', subject: 'Explore', description: '', status: 'completed' },
      { id: 'ship', subject: 'Implement', description: '', status: 'in_progress', activeForm: 'Implement' },
    ])
  })

  it('reads the merged Grok snapshot by id, and treats a cleared state as an empty list', () => {
    expect(grokTodoItemsFromOutput({
      type: 'Todo',
      TodosUpdated: {
        state: {
          todos: {
            '1': { content: 'Explore', status: 'pending' },
            '2': { content: 'Implement', status: 'cancelled' },
          },
        },
      },
    })).toEqual([
      { id: '1', subject: 'Explore', description: '', status: 'pending' },
      { id: '2', subject: 'Implement', description: '', status: 'completed' },
    ])
    expect(grokTodoItemsFromOutput({ type: 'Todo', TodosUpdated: { state: { todos: {} } } })).toEqual([])
    expect(grokTodoItemsFromOutput({ type: 'ReadFile' })).toBeNull()
  })

  it('publishes the merged result ahead of a partial todo_write input', () => {
    expect(todosUpdatedFromAcpTool({
      toolName: 'TodoWrite',
      status: 'completed',
      todos: [{ id: '2', status: 'in_progress' }],
      rawOutput: {
        type: 'Todo',
        TodosUpdated: { state: { todos: { '1': { content: 'Explore', status: 'pending' } } } },
      },
    })).toEqual({
      type: 'todos_updated',
      todos: [{ id: '1', subject: 'Explore', description: '', status: 'pending' }],
    })
  })

  it('falls back to the call input and ignores a call that is still running', () => {
    expect(todosUpdatedFromAcpTool({
      toolName: 'todo_write',
      status: 'completed',
      todos: [{ id: '1', content: 'Ship', status: 'pending' }],
    })).toEqual({
      type: 'todos_updated',
      todos: [{ id: '1', subject: 'Ship', description: '', status: 'pending' }],
    })
    expect(todosUpdatedFromAcpTool({
      toolName: 'TodoWrite',
      status: 'in_progress',
      todos: [{ content: 'Ship', status: 'pending' }],
    })).toBeNull()
    expect(todosUpdatedFromAcpTool({
      toolName: 'TodoWrite',
      status: 'completed',
      todos: [{ id: '2', status: 'in_progress' }],
    })).toBeNull()
    expect(todosUpdatedFromAcpTool({
      toolName: 'TodoWrite',
      status: 'completed',
      todos: [],
    })).toEqual({ type: 'todos_updated', todos: [] })
  })
})
