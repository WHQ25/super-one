import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexAgentMessageItem } from '@superone/shared/agent-types'
import { codexAsyncQuestionQueue, pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

const question: CodexAgentMessageItem = { id: 'first', type: 'agent_message', text: '', delivery: 'async', questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }] }
const turn: ChatMessage = { id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex', metadata: { codex: { threadId: 'thread', usage: null, items: [question] } } }
describe('async question queue across paged history', () => {
  it('restores pending requests without their source turns and removes only the accepted answer', () => {
    let session = { ...createDefaultChatCoreSession(), pendingAsyncQuestions: pendingCodexAsyncQuestions([turn]) }
    expect(codexAsyncQuestionQueue(session).map(q => q.item.id)).toEqual(['first'])
    session = { ...session, ...applyEventToSession(session, { type: 'message_start', message: { ...turn, id: 'next', metadata: undefined } }) }
    session = { ...session, ...applyEventToSession(session, { type: 'codex_item_delta', messageId: 'next', item: { ...question, id: 'second' } }) }
    expect(codexAsyncQuestionQueue(session).map(q => q.item.id)).toEqual(['first', 'second'])
    session = { ...session, ...applyEventToSession(session, { type: 'user_message_appended', message: { id: 'codex_async_answer:first', role: 'user', status: 'complete', createdAt: '', providerId: 'codex', content: [{ type: 'text', text: 'Production' }] } }) }
    expect(codexAsyncQuestionQueue(session).map(q => q.item.id)).toEqual(['second'])
    // Paging away from the accepted reply must not resurrect it.
    session.messages = []
    expect(codexAsyncQuestionQueue(session).map(q => q.item.id)).toEqual(['second'])
  })

  it('keeps an authoritative empty queue while reading an old, already answered question', () => {
    expect(codexAsyncQuestionQueue({ messages: [turn], pendingAsyncQuestions: [] })).toEqual([])
  })
})
