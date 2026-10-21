import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from './runtime'

function runtime() {
  const onPaint = vi.fn()
  const instance = new ChatRuntime({ environmentId: 'desktop' } as never, onPaint)
  instance.sessionId = 'session'
  return { instance, onPaint }
}

const item = (status: 'pending' | 'in_progress' | 'completed') => ({ id: '1', subject: 'Ship', description: '', status })

describe('clearCompletedTodos', () => {
  it('drops a finished list and leaves an open one', () => {
    const { instance, onPaint } = runtime()
    instance.session = { ...instance.session, todos: { '1': item('in_progress') }, showTodos: true }
    instance.clearCompletedTodos()
    expect(instance.session.todos).toEqual({ '1': item('in_progress') })
    expect(onPaint).not.toHaveBeenCalled()

    instance.session = { ...instance.session, todos: { '1': item('completed'), '2': { ...item('completed'), id: '2' } } }
    instance.clearCompletedTodos()
    expect(instance.session.todos).toEqual({})
    expect(instance.session.showTodos).toBe(false)
    expect(instance.session._nextTodoId).toBe(1)
    expect(onPaint).toHaveBeenCalledTimes(1)
  })
})
