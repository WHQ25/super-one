import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { applyWindowRows, mergeWindowMessages, todoUpdatesFromWindow } from './window-messages'

const row = (id: string, text: string, providerId = 'claude'): ChatMessage => ({
  id, role: id.startsWith('u') ? 'user' : 'assistant', status: 'complete', createdAt: '', providerId,
  content: [{ type: 'text', text }],
})

describe('mergeWindowMessages', () => {
  it('replaces host rows with the window and keeps an unsent bubble', () => {
    const local = { ...row('u-local', 'sending', 'local'), providerId: 'local' }
    const failed = { ...row('u-failed', 'retry'), metadata: { sendFailure: { error: 'offline' } } }
    const merged = mergeWindowMessages(
      [row('a', 'full tool output'), local, failed],
      [row('a', 'Read file.ts'), row('b', 'Done')],
    )
    expect(merged.map((message) => message.id)).toEqual(['a', 'u-local', 'u-failed', 'b'])
    expect(merged[0]?.content[0]).toMatchObject({ text: 'Read file.ts' })
  })

  it('drops a host row the window no longer holds', () => {
    expect(mergeWindowMessages([row('old', 'earlier'), row('a', 'tail')], [row('a', 'tail')]).map((message) => message.id)).toEqual(['a'])
  })
})

describe('applyWindowRows', () => {
  it('replaces only the patched row and keeps the others', () => {
    const older = row('old', 'earlier')
    const local = { ...row('u-local', 'sending', 'local'), providerId: 'local' }
    const live = row('a', 'tail')
    const next = applyWindowRows([older, live, local], [row('a', 'new tail')], {})
    expect(next.map((message) => message.id)).toEqual(['old', 'a', 'u-local'])
    expect(next[0]).toBe(older)
    expect(next[1]?.content[0]).toMatchObject({ text: 'new tail' })
    expect(next[2]).toBe(local)
  })

  it('follows order and drops a row the window released', () => {
    const local = { ...row('u-local', 'sending', 'local'), providerId: 'local' }
    const next = applyWindowRows(
      [row('old', 'earlier'), row('a', 'tail'), local],
      [row('b', 'now')],
      { removed: ['old'], order: ['a', 'b'] },
    )
    expect(next.map((message) => message.id)).toEqual(['a', 'u-local', 'b'])
  })
})

const todo = (toolUseId: string, content: string): ContentBlock => ({
  type: 'todo_result', toolUseId, summary: 'ok', todoToolName: 'TodoWrite',
  toolTodos: [{ content, status: 'pending', taskId: '1' }],
})
const session = { todos: { '9': { id: '9', subject: 'kept', description: '', status: 'pending' as const } }, _nextTodoId: 10, _todosUserDismissed: false }

describe('todoUpdatesFromWindow', () => {
  it('applies a todo_result the previous rows did not already have', () => {
    const previous = [row('a', 'shell')]
    const rows = [{ ...row('a', 'shell'), content: [todo('tw-1', 'Ship')] }]
    const patch = todoUpdatesFromWindow(session, previous, rows)
    expect(patch?.todos?.['1']).toMatchObject({ subject: 'Ship' })
    expect(patch?.todos?.['9']).toBeUndefined()
  })

  it('skips a result already applied and an older page that just scrolled in', () => {
    const previous = [{ ...row('a', 'tail'), content: [todo('tw-new', 'Current')] }]
    const rows = [
      { ...row('old', 'earlier'), content: [todo('tw-old', 'Ancient')] },
      { ...row('a', 'tail'), content: [todo('tw-new', 'Current')] },
    ]
    expect(todoUpdatesFromWindow(session, previous, rows)).toBeNull()
  })

  it('applies a todo on a new tail row', () => {
    const previous = [row('a', 'shell')]
    const rows = [{ ...row('b', 'next'), content: [todo('tw-2', 'Follow up')] }]
    expect(todoUpdatesFromWindow(session, previous, rows)?.todos?.['1']).toMatchObject({ subject: 'Follow up' })
  })

  it('does not replay a window onto an empty transcript', () => {
    const rows = [{ ...row('a', 'tail'), content: [todo('tw-1', 'Ship')] }]
    expect(todoUpdatesFromWindow(session, [], rows)).toBeNull()
  })
})
