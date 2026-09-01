import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW } from '@/stores/codex-realtime-view'
import { isRealtimeDelegationMessage, mergeCodexRealtimeMessages } from './codex-realtime-messages'

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return {
    id,
    role,
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: '',
    providerId: 'codex',
  }
}

describe('Codex realtime message merging', () => {
  it('renders voice transcript and normal Codex turns in one message stream', () => {
    const result = mergeCodexRealtimeMessages([], {
      ...EMPTY_CODEX_REALTIME_SESSION_VIEW,
      segments: [
        { id: 'voice-user', realtimeSessionId: 'rt-1', role: 'user', text: 'Inspect the logs' },
        { id: 'voice-assistant', realtimeSessionId: 'rt-1', role: 'assistant', text: 'I will take a look' },
      ],
      threadMessages: [message('codex-answer', 'assistant', 'The issue is fixed')],
    })

    expect(result.map((item) => [item.role, item.content[0]])).toEqual([
      ['user', { type: 'text', text: 'Inspect the logs' }],
      ['assistant', { type: 'text', text: 'I will take a look' }],
      ['assistant', { type: 'text', text: 'The issue is fixed' }],
    ])
  })

  it('uses canonical timeline order and overlays matching live store messages', () => {
    const timelineAssistant = {
      ...message('timeline-assistant', 'assistant', 'Old response'),
      metadata: { codex: { threadId: 'thread-1', turnId: 'turn-1', usage: null, items: [] } },
    } satisfies ChatMessage
    const liveAssistant = {
      ...message('live-assistant', 'assistant', 'Current response'),
      metadata: { codex: { threadId: 'thread-1', turnId: 'turn-1', usage: null, items: [] } },
    } satisfies ChatMessage

    const result = mergeCodexRealtimeMessages([liveAssistant], {
      ...EMPTY_CODEX_REALTIME_SESSION_VIEW,
      threadMessages: [message('voice-user', 'user', 'Question'), timelineAssistant],
    })

    expect(result.map((item) => item.id)).toEqual(['voice-user', 'live-assistant'])
    expect(result[1]?.content).toEqual([{ type: 'text', text: 'Current response' }])
  })

  it('does not duplicate voice segments already present in the canonical turn stream', () => {
    const result = mergeCodexRealtimeMessages([], {
      ...EMPTY_CODEX_REALTIME_SESSION_VIEW,
      segments: [{ id: 'voice-user', realtimeSessionId: 'rt-1', role: 'user', text: 'Question' }],
      threadMessages: [message('codex-realtime-voice-user', 'user', 'Question')],
    })

    expect(result.map((item) => item.id)).toEqual(['codex-realtime-voice-user'])
  })

  it('hides only user messages fully wrapped by realtime_delegation tags', () => {
    const hidden = message('delegation', 'user', `
      <realtime_delegation>
        <input>Inspect the project</input>
      </realtime_delegation>
    `)
    const visible = message('visible', 'user', 'Keep <realtime_delegation> as plain text')

    expect(isRealtimeDelegationMessage(hidden)).toBe(true)
    expect(isRealtimeDelegationMessage(visible)).toBe(false)
    expect(mergeCodexRealtimeMessages([hidden, visible], EMPTY_CODEX_REALTIME_SESSION_VIEW))
      .toEqual([visible])
  })
})
