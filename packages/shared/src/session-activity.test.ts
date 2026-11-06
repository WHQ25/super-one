import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { lastCompletedMessageId, summarizeSessionActivity } from './session-activity'

describe('system notice activity', () => {
  it('keeps a read completion read when a provider notice arrives later', () => {
    const reply: ChatMessage = { id: 'reply', role: 'assistant', status: 'complete', content: [], createdAt: '2026-11-06T00:00:00Z' }
    const notice: ChatMessage = { ...reply, id: 'notice', providerId: 'system', metadata: { systemNotice: { source: 'Claude Code', level: 'warning' } } }
    expect(lastCompletedMessageId([reply, notice])).toBe('reply')
    const activity = summarizeSessionActivity({ id: 's', projectPath: '/p', status: 'idle', harnessId: 'claude', messages: [reply, notice], seenCompletedMessageId: 'reply' }, [])
    expect(activity.completedMessageId).toBe(activity.seenCompletedMessageId)
    expect(lastCompletedMessageId([notice])).toBeNull()
  })
})
