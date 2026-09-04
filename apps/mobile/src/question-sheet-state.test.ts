import { describe, expect, it } from 'vitest'
import type { UserQuestion } from '@superone/shared/agent-types'
import {
  buildQuestionAnnotations,
  initialQuestionAnswers,
  questionAnswersAreComplete,
  questionKey,
  questionNoteKey,
  toggleQuestionOption,
} from './question-sheet-state'

const multi: UserQuestion = {
  header: 'Files',
  question: 'Which files?',
  multiSelect: true,
  options: [
    { label: 'Source', description: '' },
    { label: 'Tests', description: '' },
  ],
}

describe('question sheet state', () => {
  it('toggles multi-select answers in desktop protocol format', () => {
    expect(toggleQuestionOption(multi, undefined, 'Source')).toBe('Source')
    expect(toggleQuestionOption(multi, 'Source', 'Tests')).toBe('Source, Tests')
    expect(toggleQuestionOption(multi, 'Source, Tests', 'Source')).toBe('Tests')
  })

  it('requires an answer for every question', () => {
    expect(questionAnswersAreComplete([multi], {})).toBe(false)
    expect(questionAnswersAreComplete([multi], { 'Which files?': 'Other value' })).toBe(true)
  })

  it('uses the full question as the answer protocol key', () => {
    expect(questionKey(multi)).toBe('Which files?')
    expect(questionAnswersAreComplete([multi], { Files: 'Source' })).toBe(false)
  })

  it('defaults preview questions and preserves notes as annotations', () => {
    const previewQuestion: UserQuestion = {
      ...multi,
      options: [
        { label: 'Source', description: '', preview: '# Source' },
        { label: 'Tests', description: '', preview: '# Tests' },
      ],
    }
    const answers = initialQuestionAnswers([previewQuestion])
    expect(answers).toEqual({ 'Which files?': 'Source' })
    expect(buildQuestionAnnotations(
      [previewQuestion],
      answers,
      { [questionNoteKey(previewQuestion, 'Source')]: 'Use the compact version' },
    )).toEqual({ 'Which files?': { notes: 'Use the compact version' } })
  })
})
