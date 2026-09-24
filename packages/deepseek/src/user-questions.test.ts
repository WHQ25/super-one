import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'
import { useToolCallAdapter } from './test-adapters'
import { presentQuestions, type DeepseekQuestion } from './user-questions'

describe('presentQuestions', () => {
  const pick = {
    id: 'q1',
    question: 'Which color?',
    header: 'Color',
    options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }],
  }

  it('shapes a generic question for the prompt, keyed by question text', () => {
    const presented = presentQuestions([pick])
    if (presented.kind !== 'questions') throw new Error('expected questions')

    expect(presented.questions).toEqual([{
      question: 'Which color?',
      header: 'Color',
      options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: '' }],
      multiSelect: false,
    }])
    expect(presented.answer({ 'Which color?': 'Blue' })).toEqual({ answers: [{ id: 'q1', selected: ['Blue'] }] })
  })

  it('reads an unknown answer as the user\'s own words', () => {
    const presented = presentQuestions([pick])
    if (presented.kind !== 'questions') throw new Error('expected questions')

    expect(presented.answer({ 'Which color?': 'Green, please' }))
      .toEqual({ answers: [{ id: 'q1', selected: [], custom: 'Green, please' }] })
    expect(presented.answer({})).toEqual({ answers: [{ id: 'q1', selected: [] }] })
  })

  it('splits a multi-select answer back into labels', () => {
    const presented = presentQuestions([{ ...pick, multiSelect: true }])
    if (presented.kind !== 'questions') throw new Error('expected questions')

    expect(presented.answer({ 'Which color?': 'Red, Blue' }))
      .toEqual({ answers: [{ id: 'q1', selected: ['Red', 'Blue'] }] })
  })

  it('carries detail in the question text and keys the answer by it', () => {
    const presented = presentQuestions([{ ...pick, detail: 'For the header.' }])
    if (presented.kind !== 'questions') throw new Error('expected questions')

    expect(presented.questions[0]?.question).toBe('Which color?\n\nFor the header.')
    expect(presented.answer({ 'Which color?\n\nFor the header.': 'Red' }))
      .toEqual({ answers: [{ id: 'q1', selected: ['Red'] }] })
  })

  it('routes a plan-review intent to plan approval, verdict named by label', () => {
    const presented = presentQuestions([{
      id: 'plan-review',
      question: 'Approve this plan?',
      detail: '# Plan\nDo it.',
      options: [{ label: 'Approve' }, { label: 'Keep planning' }],
      intent: { kind: 'plan-review', approve: 'Approve' },
    }])
    if (presented.kind !== 'plan-review') throw new Error('expected plan review')

    expect(presented.plan).toBe('# Plan\nDo it.')
    expect(presented.answer(true)).toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
    expect(presented.answer(false, 'smaller steps'))
      .toEqual({ answers: [{ id: 'plan-review', selected: ['Keep planning'], custom: 'smaller steps' }] })
  })
})

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function session(askUser: (question: DeepseekQuestion) => Promise<AskUserQuestionAnswer | 'dismissed'>) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-questions-'))
  dirs.push(cwd)
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  const model = useToolCallAdapter(runtime)
  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: () => {},
    askUser,
  })
  disposers.push(() => agent.dispose())
  return {
    runtime,
    sessionId,
    /** What the model was told the tool returned, in the step after the call. */
    lastToolResult: () => model.toolResults.at(-1)?.join('\n') ?? '',
    async run(text: string) {
      await agent.sendText(text)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await agent.whenIdle()
    },
  }
}

describe('dsh user questions through SuperOne', () => {
  it('answers ask_user_question with the user\'s choice', async () => {
    const asked: DeepseekQuestion[] = []
    const s = await session(async (question) => {
      asked.push(question)
      if (question.kind !== 'questions') throw new Error('expected questions')
      return question.answer({ 'Pick one?': 'B' })
    })

    await s.run('CALL ask_user_question {"questions":[{"id":"q","question":"Pick one?","options":[{"label":"A"},{"label":"B"}]}]}')

    expect(asked).toHaveLength(1)
    expect(s.lastToolResult()).toContain('\\"selected\\":[\\"B\\"]')
  })

  it('tells the model to wait when the user dismisses the question', async () => {
    const s = await session(async () => 'dismissed')

    await s.run('CALL ask_user_question {"questions":[{"id":"q","question":"Pick one?"}]}')

    expect(s.lastToolResult()).toMatch(/dismissed the question/)
  })

  it('presents exit_plan_mode as a plan review and leaves plan mode on approval', async () => {
    const reviews: string[] = []
    const s = await session(async (question) => {
      if (question.kind !== 'plan-review') throw new Error('expected plan review')
      reviews.push(question.plan)
      return question.answer(true)
    })
    expect(s.runtime.setPlanMode(s.sessionId, true)).toBe(true)

    await s.run('CALL exit_plan_mode {"plan":"# Ship it"}')

    expect(reviews).toEqual(['# Ship it'])
    expect(s.lastToolResult()).toMatch(/Plan approved/)
  })

  it('keeps planning with the user\'s feedback when the plan is declined', async () => {
    const s = await session(async (question) => {
      if (question.kind !== 'plan-review') throw new Error('expected plan review')
      return question.answer(false, 'add tests')
    })
    s.runtime.setPlanMode(s.sessionId, true)

    await s.run('CALL exit_plan_mode {"plan":"# Ship it"}')

    expect(s.lastToolResult()).toMatch(/keep planning; their feedback: add tests/)
  })

  it('refuses exit_plan_mode outside plan mode', async () => {
    const s = await session(async () => { throw new Error('must not ask') })

    await s.run('CALL exit_plan_mode {"plan":"# Ship it"}')

    expect(s.lastToolResult()).toMatch(/only available in plan mode/)
  })
})
