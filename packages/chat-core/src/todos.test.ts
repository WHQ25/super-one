import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { restoredTodos } from './todos'

const turn = (...content: ContentBlock[]): ChatMessage => ({ id: 'm', role: 'assistant', status: 'complete', content, createdAt: '', providerId: 'claude' })
const todoWrite = (...statuses: string[]): ContentBlock => ({
  type: 'tool_use', toolUseId: 't', toolName: 'TodoWrite', status: 'complete',
  input: JSON.stringify({ todos: statuses.map((status, index) => ({ content: `step ${index + 1}`, status })) }),
})

describe('restoredTodos', () => {
  it('brings back the latest whole list while a todo is open', () => {
    const todos = restoredTodos([turn(todoWrite('pending')), turn(todoWrite('completed', 'in_progress'))])
    expect(Object.values(todos ?? {}).map(todo => [todo.subject, todo.status])).toEqual([['step 1', 'completed'], ['step 2', 'in_progress']])
  })

  it('leaves a finished list cleared and an incremental task list alone', () => {
    expect(restoredTodos([turn(todoWrite('pending')), turn(todoWrite('completed'))])).toBeNull()
    expect(restoredTodos([turn(todoWrite('pending'), { type: 'tool_use', toolUseId: 'c', toolName: 'TaskCreate', input: '{}' })])).toBeNull()
    expect(restoredTodos([turn({ type: 'text', text: 'no todos' })])).toBeNull()
  })
})
