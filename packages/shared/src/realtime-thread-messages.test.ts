import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { codexAsyncAnswerId, codexAsyncAnswerQuestions } from './codex-async-question'
import { mergeCodexThreadMessages } from './realtime-thread-messages'

const questions = [{ title: 'Keep only the mobile layout?', options: ['Yes', 'No'] }]

function row(id: string, role: ChatMessage['role'], text = 'Yes', turnId?: string): ChatMessage {
  return {
    id, role, status: 'complete', providerId: 'codex', createdAt: '', content: [{ type: 'text', text }],
    ...(turnId ? { metadata: { codexTimeline: { provenance: 'codex', turnId, position: 1 } } } : {}),
  }
}

function source(id = 'local-turn', itemIds = ['question']): ChatMessage {
  return {
    ...row(id, 'assistant', 'Done', 'turn'),
    metadata: { codex: { threadId: 'thread', turnId: 'turn', usage: null,
      items: itemIds.map(id => ({ type: 'agent_message', id, text: questions[0].title, questions })) } },
  }
}

function answer(itemId = 'question'): ChatMessage {
  return { ...row(codexAsyncAnswerId(itemId), 'user'), content: [{ type: 'text', text: 'Yes', codexAsyncQuestions: questions }] }
}

describe('host wakes in the Codex backing thread', () => {
  const prompt = 'A collaboration mailbox message is ready. Call session_collab_retrieve.'

  it.each([false, true])('hides unmarked cached wakes with delegation prompts kept=%s', (keepDelegationPrompts) => {
    const request = row('request', 'user', 'Review the implementation')
    const wakes = ['collab-message:message-1', 'collab-link:grant-1', 'collab-stop:child:stop-1']
      .map(id => row(id, 'user', prompt, 'turn'))
    const reply = source()
    const result = mergeCodexThreadMessages([request, reply], {
      threadMessages: [request, ...wakes, source('provider-turn')],
    }, { keepDelegationPrompts })

    expect(result.map(message => message.id)).toEqual(['request', 'provider-turn'])
    expect(result[1].content).toEqual(reply.content)
  })

  it('hides explicitly marked host wakes in both local and provider history', () => {
    const wake = { ...row('notification', 'user', prompt), metadata: { source: 'task-notification' as const } }
    expect(mergeCodexThreadMessages([wake, source()], { threadMessages: [wake, source('provider-turn')] })
      .map(message => message.id)).toEqual(['provider-turn'])
  })

  it('keeps identical human input, initial collaboration tasks and user-authored scheduled prompts', () => {
    const human = row('human-input', 'user', prompt)
    const task = { ...row('collaboration-task-grant', 'user', 'Review the implementation'),
      metadata: { source: 'collaboration' as const } }
    const scheduled = { ...row('scheduled', 'user', 'Review the implementation'),
      metadata: { source: 'task-notification' as const, userAuthored: true } }
    const messages = [human, task, scheduled]
    expect(mergeCodexThreadMessages(messages, { threadMessages: messages })).toMatchObject(messages)
  })

  it('preserves explicit human provenance and assistant replies regardless of their ids', () => {
    const human = { ...row('collab-message:explicit-user', 'user', prompt), metadata: { source: 'user' as const } }
    const assistant = row('collab-message:assistant', 'assistant', 'Received the message.')
    expect(mergeCodexThreadMessages([], { threadMessages: [human, assistant] })).toEqual([human, assistant])
  })
})

describe('async answers in the Codex backing thread', () => {
  it('merges the provider echo before a turn with the quoted answer saved after that turn', () => {
    const request = row('request', 'user', 'Update the layout')
    const reply = answer()
    const result = mergeCodexThreadMessages([request, source(), reply], {
      threadMessages: [request, row('provider-answer', 'user', 'Yes', 'turn'), source('provider-turn')],
    })

    expect(result.map(message => message.id)).toEqual(['request', 'provider-turn', reply.id])
    expect(result[2].content).toEqual(reply.content)
    expect(result[2].metadata?.codexTimeline?.turnId).toBe('turn')
  })

  it('uses the provider question when the local source turn is outside the loaded page', () => {
    const reply = answer()
    const result = mergeCodexThreadMessages([reply], {
      threadMessages: [row('provider-answer', 'user', 'Yes', 'turn'), source('provider-turn')],
    })

    expect(result.map(message => message.id)).toEqual(['provider-turn', reply.id])
    expect(result.filter(message => message.role === 'user')).toEqual([
      expect.objectContaining({ id: reply.id, content: reply.content }),
    ])
  })

  it('preserves legacy answer quotes recovered from the source question', () => {
    const reply = row(codexAsyncAnswerId('question'), 'user')
    const result = mergeCodexThreadMessages([source(), reply], {
      threadMessages: [row('provider-answer', 'user', 'Yes', 'turn'), source('provider-turn')],
    })

    expect(result.filter(message => message.role === 'user')).toHaveLength(1)
    expect(codexAsyncAnswerQuestions(result[1], result)).toEqual(questions)
  })

  it('keeps restored earlier history before the source even when the echo has the saved answer id', () => {
    const reply = answer()
    const earlier = row('earlier', 'user', 'Earlier request', 'earlier-turn')
    const result = mergeCodexThreadMessages([source(), reply], {
      threadMessages: [earlier, row(reply.id, 'user', 'Yes', 'turn'), source('provider-turn')],
    })

    expect(result.map(message => message.id)).toEqual(['earlier', 'provider-turn', reply.id])
    expect(result[2].content).toEqual(reply.content)
  })

  it('consumes repeated async replies once each and keeps an identical ordinary user message', () => {
    const request = row('request', 'user', 'Start')
    const ordinary = row('ordinary', 'user')
    const replies = [answer('question'), answer('second-question')]
    const result = mergeCodexThreadMessages([request, ordinary, source('local-turn', ['question', 'second-question']), ...replies], {
      threadMessages: [request, row('provider-ordinary', 'user', 'Yes', 'turn'),
        row('provider-answer-1', 'user', 'Yes', 'turn'), row('provider-answer-2', 'user', 'Yes', 'turn'),
        source('provider-turn', ['question', 'second-question'])],
    })

    expect(result.filter(message => message.role === 'user').map(message => message.id))
      .toEqual(['request', 'ordinary', ...replies.map(message => message.id)])
  })

  it('keeps identical text from another turn or without a source question', () => {
    const reply = answer()
    const other = row('other-turn-answer', 'user', 'Yes', 'other-turn')
    const unknown = row('unknown-source-answer', 'user', 'Yes', 'turn')

    expect(mergeCodexThreadMessages([source(), reply], { threadMessages: [other] })
      .filter(message => message.role === 'user').map(message => message.id)).toEqual([other.id, reply.id])
    expect(mergeCodexThreadMessages([reply], { threadMessages: [unknown] })
      .map(message => message.id)).toEqual([unknown.id, reply.id])
  })
})
