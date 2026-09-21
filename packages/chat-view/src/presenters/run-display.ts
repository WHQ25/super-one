/**
 * What a `*_run` block shows, derived from the calls that make up one run.
 *
 * A run is one goal pursued across several tool calls: the call that started
 * it, then one call per resume, each naming the run's `runId`. Every call's
 * result carries the steps of its own segment (`progress.completed`, reset on
 * resume) and how the segment ended — a question, or the run's outcome — so
 * the block can be rebuilt from the transcript alone. Only the call still in
 * flight has no result yet; its rows come from the live `jev_run_update`
 * events, which use the same words.
 *
 * Pure: no React, no store, so the three platforms and both hosts share it.
 */

import type { JevRunAction, JevRunActionOutcome } from '@superone/shared/agent-types'

export type RunCallStatus = 'paused' | 'done' | 'aborted'
export type RunPauseReason = 'uncertain' | 'risky' | 'no-progress' | 'budget' | 'capability'

/** One `*_run` tool call as the transcript holds it. */
export interface RunCall {
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  elapsedSeconds?: number
}

/** A later `*_run` call that resumed the run a tool block started; it renders inside that block. */
export interface RunContinuation {
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isError?: boolean
}

/** A folded resume call, with its input read the way the block's own was. */
export function runCallOf(later: RunContinuation): RunCall {
  let params: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(later.input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed as Record<string, unknown>
  } catch { /* partial input while streaming */ }
  return { params, result: later.result, isStreaming: later.status === 'streaming', isError: later.isError, elapsedSeconds: later.elapsedSeconds }
}

export interface RunQuestionView {
  id?: string
  reason: RunPauseReason | 'unknown'
  /** The first clause of the loop's `why`: what it needs, without the head-by-head numbers. */
  text: string
  options?: Array<{ key: string; label: string }>
}

/** The caller's reply that opened a segment, in a shape the UI can word per locale. */
export type RunAnswerView =
  | { kind: 'abort' | 'accept' | 'continue'; goal?: string }
  | { kind: 'choice'; label: string; goal?: string }
  | { kind: 'text'; text: string; goal?: string }
  | { kind: 'handed'; actions: number; presets: number; goal?: string }

export type RunSegmentEnd =
  | { kind: 'paused'; question: RunQuestionView }
  | { kind: 'done' | 'aborted'; why?: string }
  | { kind: 'error'; message: string }

export interface RunSegmentView {
  /** Absent on the first segment: a run starts with a goal, not an answer. */
  answer?: RunAnswerView
  actions: JevRunAction[]
  /** Something that happened to the run itself, e.g. presets taken over. */
  note?: string
  /** Rows come from live events; the segment's call has no result yet. */
  live: boolean
  end?: RunSegmentEnd
}

export interface RunView {
  status: 'running' | RunCallStatus | 'error'
  runId?: string
  goal: string
  /** Steps across every segment. */
  steps: number
  /** Wall time the loop reported on its last result. */
  elapsedMs?: number
  /** Jev's last completion verdict, when it was asked. */
  goalSatisfied?: number
  segments: RunSegmentView[]
  /** The last snapshot's identity fields, for the platform to name the target. */
  snapshot?: Record<string, unknown>
  /** The current pause, when the run is waiting on the caller. */
  question?: RunQuestionView
  /** Why the run ended, when it did. */
  why?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function tryParse(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function isOutcome(value: unknown): value is JevRunActionOutcome {
  return value === 'worked' || value === 'didnt' || value === 'unknown'
}

function isOp(value: unknown): value is JevRunAction['op'] {
  return value === 'click' || value === 'type' || value === 'press' || value === 'scroll' || value === 'wait'
}

/**
 * Results written before steps carried `op` / `target` only have the label;
 * read the verb off it so an old transcript still shows rows, not blanks.
 */
function actionFromLabel(label: string): JevRunAction {
  const target = label.replace(/\s*\[\d+\]\s*/g, ' ').trim()
  const verb = /^(\w[\w-]*)/.exec(label)?.[1]?.toLowerCase() ?? ''
  if (verb === 'wait') return { op: 'wait' }
  if (verb === 'scroll') return { op: 'scroll', target: /^scroll\s+(up|down)/i.exec(label)?.[1]?.toLowerCase() ?? 'down' }
  if (verb === 'type' || verb === 'append') return { op: 'type', target: target.replace(/^(?:Type|Append) presets\.\S+ → /, '') }
  if (verb === 'click' || verb === 'select' || verb === 'open' || verb === 'expand' || verb === 'right-click') {
    return { op: 'click', target: target.replace(/^(?:Click|Select|Open|Expand)\s+/, '') }
  }
  return { op: 'press', target: target.replace(/^Press Enter in\s+/, '') }
}

function actionsOf(progress: Record<string, unknown> | null): JevRunAction[] {
  const completed = Array.isArray(progress?.completed) ? progress.completed : []
  return completed.flatMap((step): JevRunAction[] => {
    const row = asRecord(step)
    if (!row) return []
    const label = typeof row.label === 'string' ? row.label : ''
    const base = isOp(row.op) ? { op: row.op, ...(typeof row.target === 'string' ? { target: row.target } : {}) } : actionFromLabel(label)
    return [{ ...base, ...(isOutcome(row.outcome) ? { outcome: row.outcome } : {}) }]
  })
}

const REASONS = new Set<RunPauseReason>(['uncertain', 'risky', 'no-progress', 'budget', 'capability'])

function questionOf(value: unknown): RunQuestionView | undefined {
  const question = asRecord(value)
  if (!question) return undefined
  const context = asRecord(question.context)
  const why = typeof context?.why === 'string' ? context.why : ''
  // The loop writes `<need> — <head: p, head: p …>. <what to do>`; the need is the line.
  const text = why.split(' — ')[0].split(/(?<=\.)\s/)[0].trim()
  const reason = typeof question.reason === 'string' && REASONS.has(question.reason as RunPauseReason) ? question.reason as RunPauseReason : 'unknown'
  const options = Array.isArray(question.options)
    ? question.options.flatMap((option) => {
      const o = asRecord(option)
      return o && typeof o.key === 'string' ? [{ key: o.key, label: typeof o.label === 'string' ? o.label : o.key }] : []
    })
    : undefined
  return { ...(typeof question.id === 'string' ? { id: question.id } : {}), reason, text, options }
}

/** The reply a resume call carried, worded against the question it answered. */
export function answerOf(params: Record<string, unknown>, question: RunQuestionView | undefined): RunAnswerView | undefined {
  const answer = asRecord(params.answer)
  if (!answer) return undefined
  const goal = typeof answer.goal === 'string' && answer.goal.trim() ? { goal: answer.goal.trim() } : {}
  if (answer.abort === true || answer.choice === 'abort') return { kind: 'abort', ...goal }
  if (answer.choice === 'accept') return { kind: 'accept', ...goal }
  if (answer.choice === 'continue') return { kind: 'continue', ...goal }
  if (typeof answer.choice === 'string') {
    return { kind: 'choice', label: question?.options?.find((o) => o.key === answer.choice)?.label ?? answer.choice, ...goal }
  }
  const value = asRecord(answer.value)
  if (typeof value?.text === 'string') return { kind: 'text', text: value.text, ...goal }
  if (value && (Array.isArray(value.actions) || Array.isArray(value.presets))) {
    return { kind: 'handed', actions: Array.isArray(value.actions) ? value.actions.length : 0, presets: Array.isArray(value.presets) ? value.presets.length : 0, ...goal }
  }
  if (answer.goal) return { kind: 'continue', ...goal }
  return undefined
}

/** The error text of a failed call: the host's `[Error] …` line, or the first line of whatever came back. */
function errorMessage(result: string | undefined): string {
  const text = (result ?? '').trim()
  return text.replace(/^\[Error\]\s*/i, '').split('\n')[0].slice(0, 200)
}

function callStatus(envelope: Record<string, unknown> | null): RunCallStatus | undefined {
  const status = envelope?.status
  return status === 'paused' || status === 'done' || status === 'aborted' ? status : undefined
}

/**
 * The block's whole account of a run: one segment per call, each ended by
 * what its result says, the last by the run's state. `liveActions` are the
 * rows the store has for the in-flight call.
 */
export function parseRunView(calls: RunCall[], liveActions?: JevRunAction[]): RunView {
  const first = calls[0]
  const goal = typeof first?.params.goal === 'string' ? first.params.goal.trim() : ''
  const segments: RunSegmentView[] = []
  let previousQuestion: RunQuestionView | undefined
  let runId: string | undefined
  let snapshot: Record<string, unknown> | undefined
  let elapsedMs: number | undefined
  let goalSatisfied: number | undefined
  let status: RunView['status'] = 'running'
  let question: RunQuestionView | undefined
  let why: string | undefined

  calls.forEach((call, index) => {
    const envelope = tryParse(call.result)
    const progress = asRecord(envelope?.progress)
    const failed = !!call.isError || (!call.isStreaming && !!call.result && !envelope)
    const segment: RunSegmentView = {
      ...(index > 0 ? { answer: answerOf(call.params, previousQuestion) } : {}),
      actions: envelope ? actionsOf(progress) : call.isStreaming ? liveActions ?? [] : [],
      ...(typeof progress?.note === 'string' ? { note: progress.note } : {}),
      live: call.isStreaming && !envelope,
    }
    if (typeof envelope?.runId === 'string') runId = envelope.runId
    else if (typeof call.params.runId === 'string') runId ??= call.params.runId
    if (asRecord(envelope?.snapshot)) snapshot = asRecord(envelope?.snapshot)!
    if (typeof envelope?.elapsed_ms === 'number') elapsedMs = envelope.elapsed_ms
    if (typeof progress?.goal_satisfied === 'number') goalSatisfied = progress.goal_satisfied
    const ended = callStatus(envelope)
    question = undefined
    why = undefined
    if (failed) {
      segment.end = { kind: 'error', message: errorMessage(call.result) }
      status = 'error'
    } else if (ended === 'paused') {
      const q = questionOf(envelope?.question) ?? { reason: 'unknown', text: '' }
      segment.end = { kind: 'paused', question: q }
      question = q
      status = 'paused'
    } else if (ended) {
      why = typeof envelope?.why === 'string' ? envelope.why : undefined
      segment.end = { kind: ended, ...(why ? { why } : {}) }
      status = ended
    } else if (call.isStreaming) {
      status = 'running'
    } else {
      // Sealed without a result: the call was interrupted before the loop answered.
      segment.end = { kind: 'aborted' }
      status = 'aborted'
    }
    previousQuestion = question
    segments.push(segment)
  })

  return {
    status,
    runId,
    goal,
    steps: segments.reduce((n, s) => n + s.actions.length, 0),
    elapsedMs,
    goalSatisfied,
    segments,
    snapshot,
    question,
    why,
  }
}
