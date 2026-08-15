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
})
