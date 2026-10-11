import { describe, expect, it } from 'vitest'
import { buildDecisionQueue } from './decision-queue'
import type { ChatMessage, PermissionRequest } from '@superone/shared/agent-types'

describe('buildDecisionQueue', () => {
  it('keeps permissions in arrival order, followed by the question', () => {
    const queue = buildDecisionQueue(
      [
        { requestId: 'permission-1', toolName: 'Read', input: {}, allowAlwaysAllow: false },
        { requestId: 'permission-2', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
      ],
      { requestId: 'question-1', questions: [] },
    )

    expect(queue.map(({ kind, request }) => `${kind}:${request.requestId}`)).toEqual([
      'permission:permission-1',
      'permission:permission-2',
      'question:question-1',
    ])
  })

  it('returns an empty queue when no decision is pending', () => {
    expect(buildDecisionQueue([], null)).toEqual([])
  })

  it('queues async questions in transcript order and advances only after a saved answer', () => {
    const turn: ChatMessage = {
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: ['first', 'second'].map(id => ({
        id, type: 'agent_message', delivery: 'async', text: '', questions: [{ title: id, options: null }],
      })) } },
    }
    expect(buildDecisionQueue([], null, [turn]).map(item => item.request.requestId))
      .toEqual(['codex_async_answer:first', 'codex_async_answer:second'])
    const reply: ChatMessage = { id: 'codex_async_answer:first', role: 'user', status: 'complete',
      content: [{ type: 'text', text: 'Answer' }], createdAt: '', providerId: 'codex' }
    expect(buildDecisionQueue([], null, [turn, reply]).map(item => item.request.requestId))
      .toEqual(['codex_async_answer:second'])
  })

  it('leaves app forms outside the decision tier and keeps questions ahead of agent input', () => {
    const input = (requestId: string, origin: 'agent' | 'widget'): PermissionRequest => ({
      requestId, toolName: 'composer_request', input: {}, allowAlwaysAllow: false,
      requestKind: 'input_request',
      inputRequest: { title: requestId, output: 'caller', origin: origin === 'widget' ? { kind: origin, messageId: requestId } : { kind: origin } },
    })
    const queue = buildDecisionQueue([
      input('app', 'widget'), input('agent', 'agent'),
      { requestId: 'approval', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
    ], { requestId: 'question', questions: [] })
    expect(queue.map(item => item.request.requestId)).toEqual(['approval', 'question', 'agent'])
  })

})
