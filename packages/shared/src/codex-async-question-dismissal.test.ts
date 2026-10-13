import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexAsyncUserInputQuestion } from './agent-types'
import { CODEX_ASYNC_QUESTION_DISMISSED, formatCodexAsyncQuestionReply, pendingCodexAsyncQuestions } from './codex-async-question'
import { anchorAsyncAnswer } from './transcript-boundary'
import { transcriptSegments } from './transcript-segments'
import { extractTurnOutline } from './turn-outline'
import { extendHistoryIndex } from './session-history-index'

const questions: CodexAsyncUserInputQuestion[] = [{ title: 'Environment?', options: null }, { title: 'Deadline?', options: null }]
const turn: ChatMessage = {
  id: 'turn', role: 'assistant', providerId: 'codex', status: 'streaming', content: [], createdAt: '',
  metadata: { codex: { threadId: 'thread', usage: null, items: [
    { id: 'before', type: 'reasoning', text: 'Before' },
    { id: 'question', type: 'agent_message', delivery: 'async', text: '', questions },
  ] } },
}
function reply(answers: string[], storedQuestions = questions): ChatMessage {
  return { id: 'codex_async_answer:question', role: 'user', providerId: 'codex', status: 'complete', createdAt: '',
    content: [{ type: 'text', text: formatCodexAsyncQuestionReply(storedQuestions, answers), codexAsyncQuestions: storedQuestions }] }
}

describe('dismissed async questions in the transcript', () => {
  it('keeps a durable dismissal out of bubbles and navigation without splitting the continuing turn', () => {
    const dismissal = anchorAsyncAnswer(reply(questions.map(() => CODEX_ASYNC_QUESTION_DISMISSED)), [turn])
    const continued: ChatMessage = { ...turn, metadata: { codex: { ...turn.metadata!.codex!, items: [
      ...turn.metadata!.codex!.items, { id: 'after', type: 'reasoning', text: 'After' },
    ] } } }
    const messages: ChatMessage[] = JSON.parse(JSON.stringify([continued, dismissal]))
    expect(pendingCodexAsyncQuestions(messages)).toEqual([])
    const segments = transcriptSegments(messages)
    expect(segments.map(segment => segment.id)).toEqual(['turn'])
    expect(segments[0].message.metadata?.codex?.items.map(item => item.id)).toEqual(['before', 'question', 'after'])
    expect(extractTurnOutline(messages)).toEqual([])
    expect(extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, messages).entries).toEqual([])
    expect(messages).toHaveLength(2)
  })

  it('hides single and multi-question dismissals restored without their source turn', () => {
    for (const savedQuestions of [questions.slice(0, 1), questions, [questions[0], questions[0], questions[0]]]) {
      const dismissal = reply(savedQuestions.map(() => CODEX_ASYNC_QUESTION_DISMISSED), savedQuestions)
      expect(transcriptSegments([dismissal])).toEqual([])
      expect(extractTurnOutline([dismissal])).toEqual([])
    }
  })

  it('recognizes legacy dismissals without a saved question snapshot', () => {
    const single = reply([CODEX_ASYNC_QUESTION_DISMISSED], questions.slice(0, 1))
    single.content = [{ type: 'text', text: CODEX_ASYNC_QUESTION_DISMISSED }]
    expect(transcriptSegments([single])).toEqual([])
    const multiple = reply(questions.map(() => CODEX_ASYNC_QUESTION_DISMISSED))
    multiple.content = [{ type: 'text', text: (multiple.content[0] as { text: string }).text }]
    expect(transcriptSegments([turn, multiple]).map(segment => segment.id)).toEqual(['turn'])
  })

  it('retains real answers, mixed replies and ordinary user text containing the dismissal marker', () => {
    const answered = reply(['Production', 'Friday'])
    const mixed = reply(['Production', CODEX_ASYNC_QUESTION_DISMISSED])
    const ordinary = { ...reply([CODEX_ASYNC_QUESTION_DISMISSED], questions.slice(0, 1)), id: 'ordinary' }
    for (const message of [answered, mixed, ordinary]) expect(transcriptSegments([message]).map(segment => segment.id)).toEqual([message.id])
  })
})
