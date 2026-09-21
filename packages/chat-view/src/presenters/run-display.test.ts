import { describe, expect, it } from 'vitest'
import { answerOf, parseRunView, runCallOf, type RunCall } from './run-display'

const paused = JSON.stringify({
  status: 'paused',
  runId: 'r1',
  question: {
    id: 'q1',
    type: 'choice',
    reason: 'risky',
    options: [{ key: '2', label: 'button Create' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    context: { why: 'Jev rates this step irreversible — action: click 0.91; next_step_risk 0.90. Confirm it, choose another target, or take over.' },
  },
  progress: {
    completed: [
      { label: 'Click [1] Issues', outcome: 'worked', op: 'click', target: 'Issues' },
      { label: 'Type presets.Title → [3] Add a title', outcome: 'worked', op: 'type', target: 'Add a title' },
    ],
    goal_satisfied: 0.2,
  },
  snapshot: { url: 'https://github.com/o/r/issues/new', title: 'New Issue', elements: [], text: '' },
  steps: 2,
  elapsed_ms: 5200,
})

const done = JSON.stringify({
  status: 'done',
  runId: 'r1',
  progress: { completed: [{ label: 'Click [2] Create', outcome: 'worked', op: 'click', target: 'Create' }], goal_satisfied: 0.9 },
  snapshot: { url: 'https://github.com/o/r/issues/7', title: 'Issue #7', elements: [], text: '' },
  steps: 3,
  elapsed_ms: 9100,
  why: 'done_when satisfied',
})

const start: RunCall = { params: { goal: 'File the issue', presets: [{ key: 'Title', value: 'x' }] }, result: paused, isStreaming: false }

describe('parseRunView', () => {
  it('reads one segment per call, ended by its question or the run\'s outcome, and words the answer against the question', () => {
    const view = parseRunView([
      start,
      runCallOf({ input: JSON.stringify({ runId: 'r1', answer: { questionId: 'q1', choice: '2' } }), status: 'complete', result: done }),
    ])
    expect(view.status).toBe('done')
    expect(view.runId).toBe('r1')
    expect(view.goal).toBe('File the issue')
    expect(view.steps).toBe(3)
    expect(view.elapsedMs).toBe(9100)
    expect(view.goalSatisfied).toBe(0.9)
    expect(view.why).toBe('done_when satisfied')
    expect(view.snapshot?.title).toBe('Issue #7')
    expect(view.segments).toHaveLength(2)
    expect(view.segments[0].actions).toEqual([
      { op: 'click', target: 'Issues', outcome: 'worked' },
      { op: 'type', target: 'Add a title', outcome: 'worked' },
    ])
    // The pause line is the first clause of `why`: the need, not the head numbers.
    expect(view.segments[0].end).toEqual({ kind: 'paused', question: { id: 'q1', reason: 'risky', text: 'Jev rates this step irreversible', options: [{ key: '2', label: 'button Create' }, { key: 'abort', label: 'Stop; hand control back to you' }] } })
    expect(view.segments[1].answer).toEqual({ kind: 'choice', label: 'button Create' })
    expect(view.segments[1].end).toEqual({ kind: 'done', why: 'done_when satisfied' })
  })

  it('shows the in-flight call from the live rows and reports the run as running', () => {
    const view = parseRunView(
      [start, runCallOf({ input: '{"runId":"r1","answer":{"questionId":"q1","choice":"2"}}', status: 'streaming' })],
      [{ op: 'click', target: 'Create', outcome: 'worked' }],
    )
    expect(view.status).toBe('running')
    expect(view.question).toBeUndefined()
    expect(view.segments[1]).toMatchObject({ live: true, actions: [{ op: 'click', target: 'Create', outcome: 'worked' }] })
    expect(view.steps).toBe(3)
  })

  it('keeps the pause as the run\'s state until it is answered', () => {
    const view = parseRunView([start])
    expect(view.status).toBe('paused')
    expect(view.question?.reason).toBe('risky')
  })

  it('reads rows off the label for results written before steps carried op and target', () => {
    const legacy = JSON.stringify({ status: 'done', runId: 'r2', progress: { completed: [
      { label: 'Click [1] Issues', outcome: 'worked' },
      { label: 'Type presets.Title → [3] Add a title', outcome: 'worked' },
      { label: 'Scroll down in [2] list view', outcome: 'didnt' },
      { label: 'Press Enter in [3] Add a title', outcome: 'unknown' },
      { label: 'Wait', outcome: 'unknown' },
    ] }, steps: 5 })
    const view = parseRunView([{ params: { goal: 'g' }, result: legacy, isStreaming: false }])
    expect(view.segments[0].actions).toEqual([
      { op: 'click', target: 'Issues', outcome: 'worked' },
      { op: 'type', target: 'Add a title', outcome: 'worked' },
      { op: 'scroll', target: 'down', outcome: 'didnt' },
      { op: 'press', target: 'Add a title', outcome: 'unknown' },
      { op: 'wait', outcome: 'unknown' },
    ])
  })

  it('treats a failed or unparseable result as an error segment, and a sealed call without a result as interrupted', () => {
    const failed = parseRunView([{ params: { goal: 'g' }, result: '[Error] No Jev API key is stored. Enter one in Settings.', isStreaming: false, isError: true }])
    expect(failed.status).toBe('error')
    expect(failed.segments[0].end).toEqual({ kind: 'error', message: 'No Jev API key is stored. Enter one in Settings.' })
    const sealed = parseRunView([{ params: { goal: 'g' }, isStreaming: false }])
    expect(sealed.status).toBe('aborted')
  })
})

describe('answerOf', () => {
  const question = { reason: 'capability' as const, text: '', options: [{ key: 'accept', label: 'Finish' }] }
  it('words each answer shape the caller can send', () => {
    expect(answerOf({ answer: { questionId: 'q', abort: true } }, question)).toEqual({ kind: 'abort' })
    expect(answerOf({ answer: { questionId: 'q', choice: 'accept' } }, question)).toEqual({ kind: 'accept' })
    expect(answerOf({ answer: { questionId: 'q', choice: 'continue', goal: 'Also save' } }, question)).toEqual({ kind: 'continue', goal: 'Also save' })
    expect(answerOf({ answer: { questionId: 'q', choice: '9' } }, question)).toEqual({ kind: 'choice', label: '9' })
    expect(answerOf({ answer: { questionId: 'q', value: { text: 'hello' } } }, question)).toEqual({ kind: 'text', text: 'hello' })
    expect(answerOf({ answer: { questionId: 'q', value: { actions: [{}, {}], presets: [{ key: 'a', value: 'b' }] } } }, question)).toEqual({ kind: 'handed', actions: 2, presets: 1 })
    expect(answerOf({ goal: 'no answer' }, question)).toBeUndefined()
  })
})
