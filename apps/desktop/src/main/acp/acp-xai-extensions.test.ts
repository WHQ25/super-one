import { describe, expect, it } from 'vitest'
import {
  buildAskUserQuestionRequest,
  formatGrokAskUserResponse,
  normalizeGrokQuestions,
} from './acp-xai-extensions'

describe('normalizeGrokQuestions', () => {
  it('maps Grok question shape to SuperOne UserQuestion', () => {
    const qs = normalizeGrokQuestions([
      {
        question: 'Which one?',
        options: [
          { label: 'Alpha', description: 'first choice' },
          { label: 'Beta', description: 'second', preview: '```ts\n1\n```' },
        ],
        multiSelect: null,
      },
    ])
    expect(qs).toHaveLength(1)
    expect(qs[0]).toMatchObject({
      question: 'Which one?',
      multiSelect: false,
      options: [
        { label: 'Alpha', description: 'first choice' },
        { label: 'Beta', description: 'second', preview: '```ts\n1\n```' },
      ],
    })
    expect(qs[0].header).toBeTruthy()
  })

  it('honors multi_select / multiSelect true', () => {
    expect(normalizeGrokQuestions([{ question: 'Q?', options: [{ label: 'A' }], multi_select: true }])[0].multiSelect).toBe(true)
    expect(normalizeGrokQuestions([{ question: 'Q?', options: [{ label: 'A' }], multiSelect: true }])[0].multiSelect).toBe(true)
  })

  it('skips empty or invalid entries', () => {
    expect(normalizeGrokQuestions([null, {}, { question: '' }, 'x'])).toEqual([])
  })
})

describe('formatGrokAskUserResponse', () => {
  it('formats accepted answers as string arrays', () => {
    expect(formatGrokAskUserResponse({
      kind: 'accepted',
      answers: { 'Which one?': 'Alpha' },
      annotations: { 'Which one?': { notes: 'n1' } },
    })).toEqual({
      accepted: {
        answers: { 'Which one?': ['Alpha'] },
        partial_answers: {},
        annotations: { 'Which one?': { notes: 'n1' } },
      },
    })
  })

  it('splits multi-select comma-joined answers', () => {
    const res = formatGrokAskUserResponse({
      kind: 'accepted',
      answers: { 'Pick many': 'A, B' },
    })
    expect(res).toEqual({
      accepted: {
        answers: { 'Pick many': ['A', 'B'] },
        partial_answers: {},
      },
    })
  })

  it('formats cancelled', () => {
    expect(formatGrokAskUserResponse({ kind: 'cancelled' })).toEqual({ cancelled: {} })
  })
})

describe('buildAskUserQuestionRequest', () => {
  it('builds request with stable requestId', () => {
    const req = buildAskUserQuestionRequest({
      questions: [{ question: 'Go?', options: [{ label: 'Yes', description: '' }] }],
    }, 'req-1')
    expect(req.requestId).toBe('req-1')
    expect(req.questions[0].question).toBe('Go?')
  })
})
