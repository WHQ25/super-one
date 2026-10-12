import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { codexContentEvents } from '@superone/shared/test-fixtures/codex-content'
import { anchorAsyncAnswer } from '@superone/shared/transcript-boundary'
import { applyEventToSession } from './reducer'
import { createDefaultChatCoreSession } from './defaults'
import type { ChatCoreSession } from './types'

const QUESTIONS = [{ title: 'Which environment?', options: ['Production', 'Staging'] }]

function contentSession(): ChatCoreSession {
  const message: ChatMessage = {
    id: 'm', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
    metadata: { codex: { threadId: 't', usage: null, items: [] } },
  }
  return { ...createDefaultChatCoreSession(), status: 'streaming', messages: [message] }
}

function apply(session: ChatCoreSession, ...events: AgentEvent[]): ChatCoreSession {
  return events.reduce((current, event) => ({ ...current, ...applyEventToSession(current, event) }), session)
}

const streamed = (...items: CodexThreadItem[]) => codexContentEvents('m', ...items)

describe('a content-shaped Codex turn in chat-core', () => {
  it('keeps its content at completion and seals a tool still running', () => {
    let session = apply(contentSession(), ...streamed(
      { id: 'cmd', type: 'command_execution', command: 'bun test', aggregatedOutput: '', status: 'in_progress' },
      { id: 'a', type: 'agent_message', text: 'Done' },
    ))
    session = apply(session, { type: 'message_complete', messageId: 'm',
      metadata: { codex: { threadId: 't', usage: null, items: [], finalResponse: 'Done' } } })
    const content = session.messages[0]!.content
    expect(content.map(block => block.type)).toEqual(['tool_use', 'text'])
    expect(content[0]).toMatchObject({ toolName: 'Bash', status: 'complete' })
  })

  it('queues an async question it asks, unless already answered', () => {
    const asking = streamed({ id: 'q', type: 'agent_message', text: '', delivery: 'async', questions: QUESTIONS })
    const session = apply(contentSession(), ...asking)
    expect(session.pendingAsyncQuestions?.map(question => [question.messageId, question.item.id])).toEqual([['m', 'q']])

    const answer: ChatMessage = { id: 'codex_async_answer:q', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'codex' }
    const answered = apply({ ...contentSession(), messages: [...contentSession().messages, answer] }, ...asking)
    expect(answered.pendingAsyncQuestions ?? []).toEqual([])
  })

  it('anchors an accepted answer at the turn that asked', () => {
    const session = apply(contentSession(), ...streamed({ id: 'q', type: 'agent_message', text: '', delivery: 'async', questions: QUESTIONS }))
    const other: ChatMessage = { ...session.messages[0]!, id: 'later', content: [] }
    const answer = anchorAsyncAnswer({ id: 'codex_async_answer:q', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'codex' },
      [session.messages[0]!, other])
    expect(answer.metadata?.transcriptBoundary?.messageId).toBe('m')
  })
})
