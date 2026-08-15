import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { buildOrphanTaskNotificationMessage } from './orphan-task-notification'

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'content'>): ChatMessage {
  return {
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude-base',
    ...partial,
  }
}

function notification(
  overrides: Partial<Extract<AgentEvent, { type: 'task_notification' }>> = {},
): Extract<AgentEvent, { type: 'task_notification' }> {
  return {
    type: 'task_notification',
    taskId: 'task-abc',
    toolUseId: 'toolu_1',
    taskStatus: 'completed',
    ...overrides,
  } as Extract<AgentEvent, { type: 'task_notification' }>
}

const liveBlock = msg({
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'tool_use', toolUseId: 'toolu_1', toolName: 'Bash', input: {} }],
})

describe('buildOrphanTaskNotificationMessage', () => {
  it('mints a row when no launching tool block remains', () => {
    expect(buildOrphanTaskNotificationMessage(notification(), [], {})).not.toBeNull()
  })

  it('stays silent when the launching block is in the current turn', () => {
    const messages = [
      msg({ id: 'u2', role: 'user', content: [{ type: 'text', text: 'watch ci' }] }),
      liveBlock,
    ]
    expect(buildOrphanTaskNotificationMessage(notification(), messages, {})).toBeNull()
  })

  it('mints a row when the launching block is only in an earlier turn', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: [{ type: 'text', text: 'watch ci' }] }),
      liveBlock,
      msg({ id: 'u2', role: 'user', content: [{ type: 'text', text: 'what else?' }] }),
    ]
    const row = buildOrphanTaskNotificationMessage(notification(), messages, {})
    expect(row?.metadata?.taskNotification?.status).toBe('completed')
  })

  it('treats the whole transcript as the current turn when no user message exists', () => {
    expect(buildOrphanTaskNotificationMessage(notification(), [liveBlock], {})).toBeNull()
  })

  it('stays silent for host browser_download tasks', () => {
    expect(
      buildOrphanTaskNotificationMessage(notification({ taskId: 'bdl_1', toolUseId: undefined }), [], {}),
    ).toBeNull()
  })

  it('omits a summary that restates the task title from meta and export text', () => {
    const row = buildOrphanTaskNotificationMessage(
      notification({ summary: 'Inspect what the domain currently serves' }),
      [],
      { toolu_1: { description: 'Inspect what the domain currently serves' } },
    )
    expect(row?.metadata?.taskNotification?.description).toBe('Inspect what the domain currently serves')
    expect(row?.metadata?.taskNotification?.summary).toBeUndefined()
    const text = row?.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toBe('Background task completed: Inspect what the domain currently serves')
  })

  it('keeps a distinct outcome in meta and export text', () => {
    const row = buildOrphanTaskNotificationMessage(
      notification({ summary: 'exit 0' }),
      [],
      { toolu_1: { description: 'watch domain' } },
    )
    expect(row?.metadata?.taskNotification?.summary).toBe('exit 0')
    const text = row?.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toBe('Background task completed: watch domain — exit 0')
  })
})
