import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { applyTodoResult } from '@superone/chat-core'
import { deliveryPolicy } from '../delivery-policy'
import { EventProfile } from './profile'
import { stripMessagesForRemote } from './remote-content'

function message(content: ContentBlock[]): ChatMessage {
  return { id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content }
}

const call = (toolName: string, input: string): ContentBlock => ({
  type: 'tool_use', toolName, toolUseId: 'tu', input, status: 'complete',
})
const result = (extra: Partial<Extract<ContentBlock, { type: 'tool_result' }>> = {}): ContentBlock => ({
  type: 'tool_result', toolUseId: 'tu', summary: 'ok', ...extra,
})

function stripped(content: ContentBlock[]) {
  const block = stripMessagesForRemote([message(content)])[0]?.content.find((item) => item.type === 'todo_result')
  return block?.type === 'todo_result' ? block : undefined
}

function rewritten(toolName: string, input: string, extra: Partial<Extract<ContentBlock, { type: 'tool_result' }>> = {}) {
  const profile = new EventProfile(deliveryPolicy('relay', 'phone'))
  expect(profile.apply({
    type: 'content_delta', sessionId: 's', messageId: 'm',
    delta: call(toolName, input),
  } as AgentEvent)).toEqual([])
  const [event] = profile.apply({
    type: 'content_delta', sessionId: 's', messageId: 'm',
    delta: result(extra),
  } as AgentEvent)
  return event?.type === 'content_delta' && event.delta.type === 'todo_result' ? event.delta : undefined
}

describe('todo_result items', () => {
  it('does not turn a TaskUpdate that set no status into pending', () => {
    const input = JSON.stringify({ taskId: '3', subject: 'Rename the task' })
    const item = expect.objectContaining({ content: 'Rename the task', status: '', taskId: '3', subject: 'Rename the task' })
    const block = stripped([call('TaskUpdate', input), result()])
    expect(block?.toolTodos).toEqual([item])
    expect(rewritten('TaskUpdate', input)?.toolTodos).toEqual([item])
    const session = {
      todos: { '3': { id: '3', subject: 'Ship', description: '', status: 'in_progress' as const } },
      _nextTodoId: 4,
      _todosUserDismissed: false,
    }
    expect(applyTodoResult(session, { todoToolName: 'TaskUpdate', toolTodos: block?.toolTodos })?.todos?.['3']).toMatchObject({
      status: 'in_progress', subject: 'Rename the task',
    })
  })

  it('keeps a status the call set, and leaves an error result with no items', () => {
    const input = JSON.stringify({ taskId: '3', status: 'completed' })
    expect(stripped([call('TaskUpdate', input), result()])?.toolTodos?.[0]?.status).toBe('completed')
    expect(rewritten('TaskUpdate', input)?.toolTodos?.[0]?.status).toBe('completed')
    expect(stripped([call('TaskCreate', JSON.stringify({ subject: 'New' })), result()])?.toolTodos?.[0]?.status).toBe('pending')
    expect(stripped([call('TaskUpdate', input), result({ isError: true })])?.toolTodos).toBeUndefined()
    expect(rewritten('TaskUpdate', input, { isError: true })?.toolTodos).toBeUndefined()
  })
})
