import { describe, expect, it } from 'vitest'
import { formatCodexAsyncQuestionReply, parseCodexAsyncQuestionReply } from './codex-async-question'

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
