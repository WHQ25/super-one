import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { applyEventToSession } from './reducer'
import { createDefaultChatCoreSession } from './defaults'
import type { ChatCoreSession } from './types'

const suggest: CodexThreadItem = {
  id: 'mcp', type: 'mcp_tool_call', server: 'superone', tool: 'session_suggest_task', arguments: { title: 'Follow up', prompt: 'Do it' },
  status: 'completed', result: { content: [{ type: 'text', text: '{"taskId":"task-1"}' }], structuredContent: null },
}

function legacySession(items: CodexThreadItem[], status: ChatMessage['status'] = 'streaming'): ChatCoreSession {
  const message: ChatMessage = {
    id: 'm', role: 'assistant', status, content: [], createdAt: '', providerId: 'codex',
    metadata: { codex: { threadId: 't', usage: null, items } },
  }
  return { ...createDefaultChatCoreSession(), messages: [message] }
}

function apply(session: ChatCoreSession, ...events: AgentEvent[]): ChatCoreSession {
  return events.reduce((current, event) => ({ ...current, ...applyEventToSession(current, event) }), session)
}

describe('legacy Codex content at chat-core ingress', () => {
  it('keeps a suggested task outcome through the next re-derivation', () => {
    let session = apply(legacySession([suggest], 'complete'), { type: 'codex_thread_started', messageId: 'm', threadId: 't' })
    session = apply(session, { type: 'suggested_task_updated', taskId: 'task-1', state: { status: 'dismissed' } })
    session = apply(session, { type: 'codex_thread_started', messageId: 'm', threadId: 't2' })
    const card = session.messages[0]!.content.find(block => block.type === 'tool_use')
    expect(card).toMatchObject({ toolUseId: 'mcp', suggestedTask: { status: 'dismissed' } })
  })

  it('leaves non-Codex messages untouched', () => {
    const session = { ...createDefaultChatCoreSession(), messages: [] }
    const next = apply(session,
      { type: 'message_start', message: { id: 'c', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } },
      { type: 'content_delta', messageId: 'c', delta: { type: 'text', text: 'hi' } })
    expect(next.messages[0]!.content).toEqual([{ type: 'text', text: 'hi' }])
  })
})
