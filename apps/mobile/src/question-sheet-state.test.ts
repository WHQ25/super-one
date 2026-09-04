import { describe, expect, it } from 'vitest'
import type { UserQuestion } from '@superone/shared/agent-types'
import { questionAnswersAreComplete, toggleQuestionOption } from './question-sheet-state'

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
    expect(questionAnswersAreComplete([multi], { Files: 'Other value' })).toBe(true)
  })
})
