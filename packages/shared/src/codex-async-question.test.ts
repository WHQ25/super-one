import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { formatCodexAsyncQuestionReply, parseCodexAsyncQuestionReply, pendingCodexAsyncQuestions } from './codex-async-question'
import { withCodexContent } from './codex-content'

const questions = [
  { title: 'Which environment?', options: ['Staging', 'Production'] },
  { title: 'What deadline?', options: null },
]

describe('async question reply display', () => {
  it('restores each answer without losing paragraphs or repeated question text', () => {
    const answers = ['Use Staging.\n\nWhich environment?\nThe preview environment.', 'Friday\nBefore noon']
    expect(parseCodexAsyncQuestionReply(questions, formatCodexAsyncQuestionReply(questions, answers))).toEqual(answers)
  })

  it('keeps a single free-text answer verbatim', () => {
    const reply = 'First paragraph\n\nSecond paragraph'
    expect(parseCodexAsyncQuestionReply(questions.slice(0, 1), reply)).toEqual([reply])
  })

  it('falls back to the full reply for unrecognized history or ambiguous boundaries', () => {
    expect(parseCodexAsyncQuestionReply(questions, 'Staging and Friday')).toBeNull()
    expect(parseCodexAsyncQuestionReply(questions, 'Which environment?\nStaging')).toBeNull()
    expect(parseCodexAsyncQuestionReply([], 'Staging')).toBeNull()
    const reply = formatCodexAsyncQuestionReply(questions, ['Staging\n\nWhat deadline?\nAsk the release owner.', 'Friday'])
    expect(parseCodexAsyncQuestionReply(questions, reply)).toBeNull()
  })

  it('supports translated and repeated question titles', () => {
    const repeated = [{ title: '确认时间？', options: null }, { title: '确认时间？', options: null }]
    expect(parseCodexAsyncQuestionReply(repeated, formatCodexAsyncQuestionReply(repeated, ['周五', '周六']))).toEqual(['周五', '周六'])
  })
})

describe('pending async questions', () => {
  const questions = [{ title: 'Which environment?', options: ['Staging', 'Production'] }]
  const stored: ChatMessage = {
    id: 'turn', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'Final' }], createdAt: '', providerId: 'codex',
    metadata: { codex: { threadId: 't', usage: null, items: [
      { id: 'q', type: 'agent_message', text: 'Pick one', delivery: 'async', questions },
      { id: 's', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed' } },
        childItems: { child: [{ id: 'cq', type: 'agent_message', text: 'Child asks', delivery: 'async', questions }] } },
    ] } },
  }

  it('reads the turn\'s own questions the same from a stored row and from derived content', () => {
    for (const message of [stored, withCodexContent(stored)]) {
      expect(pendingCodexAsyncQuestions([message]).map(q => q.item)).toEqual([
        { id: 'q', type: 'agent_message', text: 'Pick one', delivery: 'async', questions },
      ])
    }
  })
})
