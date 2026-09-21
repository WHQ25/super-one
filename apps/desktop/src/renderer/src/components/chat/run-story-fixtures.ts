/**
 * Result envelopes and resume inputs shaped the way the `*_run` tools write
 * them (`FastRun.result` / `pause` in apps/desktop/src/main/jev/loop.ts), so
 * the run stories exercise the same parser the chat does.
 */

import type { JevRunAction, JevRunActionOutcome } from '@superone/shared/agent-types'
import type { RunContinuation } from '@superone/chat-view/presenters/run-display'

/** A finished step as `progress.completed` lists it: the caller's label plus the chat's own words. */
export function step(op: JevRunAction['op'], target: string, outcome: JevRunActionOutcome = 'worked', label = `${op === 'type' ? 'Type presets.Value → ' : op === 'click' ? 'Click ' : op === 'scroll' ? 'Scroll ' : 'Press '}${target}`) {
  return { label, outcome, op, target }
}

/** The steps of one segment as the live events would have reported them. */
export function liveOf(completed: ReturnType<typeof step>[]): JevRunAction[] {
  return completed.map(({ op, target, outcome }) => ({ op, target, outcome }))
}

export interface RunEnvelopeOptions {
  status: 'paused' | 'done' | 'aborted'
  runId: string
  completed?: ReturnType<typeof step>[]
  question?: Record<string, unknown>
  why?: string
  note?: string
  goalSatisfied?: number
  steps?: number
  elapsedMs?: number
  snapshot?: Record<string, unknown>
}

export function runEnvelope({ status, runId, completed = [], question, why, note, goalSatisfied, steps, elapsedMs, snapshot }: RunEnvelopeOptions): string {
  return JSON.stringify({
    status,
    runId,
    ...(question ? { question } : {}),
    progress: { completed, ...(goalSatisfied != null ? { goal_satisfied: goalSatisfied, still_loading: 0.04 } : {}), ...(note ? { note } : {}) },
    snapshot: { ...snapshot, elements: [], text: '' },
    steps: steps ?? completed.length,
    elapsed_ms: elapsedMs ?? completed.length * 2600,
    ...(why ? { why } : {}),
    ...(status === 'paused' ? { next: 'Read progress first: …' } : {}),
  })
}

/** The questions the loop asks, with the `why` it writes for each reason. */
export const QUESTIONS = {
  risky: (target: string) => ({
    id: 'q1',
    type: 'choice',
    reason: 'risky',
    options: [{ key: '2', label: `button ${target}` }, { key: 'open:1', label: 'Open Title' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    context: { why: `Jev rates this step irreversible — action: click 0.91; click_target: [2] ${target} 0.88; next_step_risk 0.90. Confirm it, choose another target, or take over.` },
  }),
  noProgress: () => ({
    id: 'q2',
    type: 'choice',
    reason: 'no-progress',
    options: [{ key: '1', label: 'button Save' }, { key: 'accept', label: 'Finish: the goal is reached as the page stands' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    context: { why: 'No offered action advances the goal and the page cannot scroll further — action: none_useful 0.64, then append 0.35; goal_satisfied 0.45. Pick an element or take over.' },
  }),
  budget: () => ({
    id: 'q3',
    type: 'choice',
    reason: 'budget',
    options: [{ key: 'continue', label: 'Continue with a fresh budget' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    context: { why: 'maxSteps 30 reached' },
  }),
  capability: () => ({
    id: 'q4',
    type: 'value',
    reason: 'capability',
    options: [{ key: 'accept', label: 'Finish: the goal is reached as the page stands' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    schema: { type: 'object', properties: { actions: { type: 'array' }, presets: { type: 'array' } } },
    context: { target: { index: '1', role: 'image', label: 'Picture', bounds: [120, 80, 640, 420] }, hint: 'path', why: 'A path on [1] Picture is needed; no offered element is that place — action: needs_input 0.79; hand_target: [1] Picture 0.99; input_kind: path 0.98. Supply actions and/or presets as value, choose accept if the goal is reached as the page stands, or take over.' },
  }),
  value: (field: string) => ({
    id: 'q5',
    type: 'value',
    reason: 'uncertain',
    options: [{ key: 'accept', label: 'Finish: the goal is reached as the page stands' }, { key: 'abort', label: 'Stop; hand control back to you' }],
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    context: { why: `Jev wants to append to [3] ${field} and no preset matched it — action: append 0.88; append_target: [3] ${field} 0.80. Supply the text, choose accept if the goal is reached as the page stands, or take over.` },
  }),
} as const

/** A resume call as the transcript holds it. */
export function resume(
  runId: string,
  answer: Record<string, unknown>,
  opts: { result?: string; status?: 'streaming' | 'complete'; elapsedSeconds?: number; isError?: boolean; description?: string } = {},
): RunContinuation {
  return {
    input: JSON.stringify({ ...(opts.description ? { description: opts.description } : {}), runId, answer: { questionId: 'q1', ...answer } }),
    status: opts.status ?? 'complete',
    result: opts.result,
    elapsedSeconds: opts.elapsedSeconds,
    isError: opts.isError,
  }
}

/** Thirty-plus steps over three segments: the long case every platform must bound. */
export function longSegments(label: (i: number) => string): ReturnType<typeof step>[][] {
  const seg = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => {
    const i = from + k
    return i % 4 === 3 ? step('scroll', 'down', i % 8 === 7 ? 'didnt' : 'worked') : step('click', label(i + 1), i % 5 === 4 ? 'unknown' : 'worked')
  })
  return [seg(0, 12), seg(12, 24), seg(24, 34)]
}
