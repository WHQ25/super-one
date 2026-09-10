import type {
  AgentEvent,
  AskUserQuestionRequest,
  PlanApprovalRequest,
  QuestionAnnotations,
  UserQuestion,
} from '@superone/shared/agent-types'
import { buildAnsweredQuestionInput } from '@superone/shared/ask-user-question'

/**
 * Host-side pending-interaction registry for the Cursor harness.
 *
 * `@cursor/sdk` 1.0.30 exposes no native approval or question hook for local
 * or cloud runs (the local executor auto-approves tool calls and rejects the
 * built-in `askQuestion` query; see `cursor-runtime.ts`). The two interactions
 * SuperOne *can* honor are therefore host-driven:
 *
 * - questions raised through the SDK `customTools` callback surface, whose
 *   `execute` awaits the user's answer;
 * - plan approvals surfaced when a `createPlan` tool call completes, whose
 *   decision is delivered back as a follow-up turn.
 *
 * The registry owns the request → resolver map so every request is registered
 * *before* its `AgentEvent` is broadcast. `Session.getPendingInteractions()`
 * (and through it `MobileBroadcaster` / `list_session_activity`) reads the map
 * synchronously while the event is still in flight, so the order matters.
 *
 * Lifecycle (owner: `CursorBackend`):
 * - questions live for one run — answered, dismissed, or cancelled when the
 *   run settles, is interrupted, or the runtime is rebuilt/closed;
 * - a plan is raised only for a run whose SDK status is `finished` and that was
 *   not cancelled/closed meanwhile; it stays pending across an ordinary turn end
 *   and a mode rebuild, and is cancelled by a newer plan, a new user turn, an
 *   explicit interrupt, or session close. A decision whose continuation
 *   (mode switch + host follow-up turn) fails is reported as a transcript error.
 */

export type CursorQuestionAnswer =
  | { kind: 'answered'; answers: Record<string, string>; annotations?: QuestionAnnotations }
  | { kind: 'dismissed' }
  | { kind: 'cancelled'; reason: string }

export type CursorPlanDecision =
  | { kind: 'approved'; feedback?: string }
  | { kind: 'rejected'; feedback?: string }
  | { kind: 'cancelled'; reason: string }

interface PendingEntry<T> {
  event: AgentEvent
  resolve: (value: T) => void
}

export class CursorInteractionRegistry {
  private readonly questions = new Map<string, PendingEntry<CursorQuestionAnswer>>()
  private readonly plans = new Map<string, PendingEntry<CursorPlanDecision>>()

  /** @param emit Event sink (the backend's listener fan-out). */
  constructor(private readonly emit: (event: AgentEvent) => void) {}

  /** Number of unanswered requests across both kinds. */
  get size(): number {
    return this.questions.size + this.plans.size
  }

  /** Registers the resolver, then broadcasts `ask_user_question`. */
  askQuestion(request: AskUserQuestionRequest): Promise<CursorQuestionAnswer> {
    // A re-issued id (SDK retry) supersedes the previous prompt without
    // clearing the UI: the new event carries the same requestId.
    this.questions.get(request.requestId)?.resolve({ kind: 'cancelled', reason: 'superseded' })
    const event: AgentEvent = { type: 'ask_user_question', request }
    return new Promise((resolve) => {
      this.questions.set(request.requestId, { event, resolve })
      this.emit(event)
    })
  }

  /**
   * Registers the resolver, then broadcasts `plan_approval`. Only one plan can
   * be awaiting a decision: a newer plan replaces any older one, so the user is
   * never asked to approve a plan the agent has already revised.
   */
  requestPlanApproval(request: PlanApprovalRequest): Promise<CursorPlanDecision> {
    this.cancelPlans('superseded by a newer plan')
    const event: AgentEvent = { type: 'plan_approval', request }
    return new Promise((resolve) => {
      this.plans.set(request.requestId, { event, resolve })
      this.emit(event)
    })
  }

  /** @returns false when the id is unknown (already answered or never ours). */
  respondToQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): boolean {
    const entry = this.questions.get(requestId)
    if (!entry) return false
    this.questions.delete(requestId)
    entry.resolve({ kind: 'answered', answers, ...(annotations ? { annotations } : {}) })
    this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
    return true
  }

  dismissQuestion(requestId: string): boolean {
    const entry = this.questions.get(requestId)
    if (!entry) return false
    this.questions.delete(requestId)
    entry.resolve({ kind: 'dismissed' })
    this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
    return true
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): boolean {
    const entry = this.plans.get(requestId)
    if (!entry) return false
    this.plans.delete(requestId)
    entry.resolve(approved
      ? { kind: 'approved', ...(feedback ? { feedback } : {}) }
      : { kind: 'rejected', ...(feedback ? { feedback } : {}) })
    this.emit({
      type: 'interaction_resolved',
      interactionType: 'plan_approval',
      requestId,
      approved,
      ...(feedback ? { feedback } : {}),
    })
    return true
  }

  /**
   * Cancel unanswered questions. Questions are turn-scoped: once the run that
   * asked them ended (completed, interrupted, timed out) nobody is waiting for
   * the answer, so leaving them pending would only keep a stale badge alive.
   */
  cancelQuestions(reason: string): void {
    for (const [requestId, entry] of this.questions) {
      this.questions.delete(requestId)
      entry.resolve({ kind: 'cancelled', reason })
      this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
    }
  }

  /** Cancel plan approvals nobody can act on any more (new user turn, close). */
  cancelPlans(reason: string): void {
    for (const [requestId, entry] of this.plans) {
      this.plans.delete(requestId)
      entry.resolve({ kind: 'cancelled', reason })
      this.emit({ type: 'interaction_resolved', interactionType: 'plan_approval', requestId, approved: false })
    }
  }

  /** Cancel every pending request (backend close). */
  cancelAll(reason: string): void {
    this.cancelQuestions(reason)
    this.cancelPlans(reason)
  }

  /** Replay payload for `SessionBackend.getPendingInteractions()`. */
  pending(): AgentEvent[] {
    return [...this.questions.values(), ...this.plans.values()].map((entry) => entry.event)
  }
}

/** Name the model sees for the host question bridge (`custom-user-tools` server). */
export const CURSOR_ASK_USER_QUESTION_TOOL = 'superone_ask_user_question'

/** Bounds advertised in the schema and enforced before a prompt is raised. */
export const CURSOR_QUESTION_LIMITS = { maxQuestions: 4, minOptions: 2, maxOptions: 4 } as const

/** Input accepted by the host `superone_ask_user_question` custom tool. */
export interface CursorAskUserQuestionInput {
  questions: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

/** JSON Schema advertised to the model for the question tool. */
export const CURSOR_ASK_USER_QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: CURSOR_QUESTION_LIMITS.maxQuestions,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user.' },
          header: { type: 'string', description: 'Short label (≤ 12 chars) shown as the question chip.' },
          options: {
            type: 'array',
            minItems: CURSOR_QUESTION_LIMITS.minOptions,
            maxItems: CURSOR_QUESTION_LIMITS.maxOptions,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
              additionalProperties: false,
            },
          },
          multiSelect: { type: 'boolean', description: 'Allow more than one option to be selected.' },
        },
        required: ['question', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const

export type CursorQuestionParse =
  | { ok: true; request: AskUserQuestionRequest }
  | { ok: false; error: string }

/**
 * Validate tool args against the advertised schema and build the shared
 * `AskUserQuestionRequest`. Validation is all-or-nothing: a payload that is
 * partially malformed is rejected with an actionable message instead of being
 * trimmed into a prompt the model never asked for.
 */
export function buildCursorAskUserQuestionRequest(requestId: string, args: unknown): CursorQuestionParse {
  const { maxQuestions, minOptions, maxOptions } = CURSOR_QUESTION_LIMITS
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : null
  if (!rec || !Array.isArray(rec.questions)) return { ok: false, error: '`questions` must be an array.' }
  if (rec.questions.length === 0) return { ok: false, error: 'Provide at least one question.' }
  if (rec.questions.length > maxQuestions) {
    return { ok: false, error: `Ask at most ${maxQuestions} questions per call (got ${rec.questions.length}).` }
  }
  const questions: UserQuestion[] = []
  for (const [index, raw] of rec.questions.entries()) {
    const at = `questions[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `${at} must be an object.` }
    const row = raw as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (!question) return { ok: false, error: `${at}.question must be a non-empty string.` }
    if (!Array.isArray(row.options)) return { ok: false, error: `${at}.options must be an array.` }
    if (row.options.length < minOptions || row.options.length > maxOptions) {
      return { ok: false, error: `${at}.options must contain ${minOptions}–${maxOptions} options (got ${row.options.length}).` }
    }
    const options: UserQuestion['options'] = []
    for (const [optIndex, opt] of row.options.entries()) {
      const optAt = `${at}.options[${optIndex}]`
      if (!opt || typeof opt !== 'object' || Array.isArray(opt)) return { ok: false, error: `${optAt} must be an object.` }
      const o = opt as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      if (!label) return { ok: false, error: `${optAt}.label must be a non-empty string.` }
      options.push({ label, description: typeof o.description === 'string' ? o.description : '' })
    }
    questions.push({
      question,
      header: typeof row.header === 'string' && row.header.trim() ? row.header.trim() : question.slice(0, 12),
      options,
      multiSelect: row.multiSelect === true,
    })
  }
  return { ok: true, request: { requestId, questions } }
}

/** Free-text notes the user attached per question (previews are host UI, not model input). */
function questionNotes(annotations: QuestionAnnotations | undefined): Record<string, string> {
  const notes: Record<string, string> = {}
  for (const [question, annotation] of Object.entries(annotations ?? {})) {
    const text = annotation?.notes?.trim()
    if (text) notes[question] = text
  }
  return notes
}

/**
 * Serialize the user's answer for the model (custom tool result payload).
 * Dismissal is reported neutrally: it is neither consent nor an error, so the
 * model is told to weigh whether the missing answer blocks the request.
 */
export function formatCursorQuestionResult(answer: CursorQuestionAnswer): Record<string, unknown> {
  if (answer.kind === 'answered') {
    const answers: Record<string, string> = {}
    for (const [key, value] of Object.entries(answer.answers)) {
      if (value) answers[key] = value
    }
    const notes = questionNotes(answer.annotations)
    return { outcome: 'answered', answers, ...(Object.keys(notes).length > 0 ? { notes } : {}) }
  }
  if (answer.kind === 'dismissed') {
    return {
      outcome: 'dismissed',
      note: 'The user dismissed the question without answering. This is not approval. '
        + 'If the answer is required for the requested action, stop and say what you still need; '
        + 'otherwise continue only with work that does not depend on it.',
    }
  }
  return { outcome: 'cancelled', reason: answer.reason }
}

/** True for the wire spelling Cursor reports (`mcp__custom-user-tools__<tool>`) or the bare name. */
export function isCursorQuestionTool(toolName: string): boolean {
  return toolName === CURSOR_ASK_USER_QUESTION_TOOL || toolName.endsWith(`__${CURSOR_ASK_USER_QUESTION_TOOL}`)
}

/**
 * Shape a question tool call for the shared `AskUserQuestion` presenter.
 * The answered input mirrors what Claude's `canUseTool` back-fills
 * (`questions` + `answers` + `annotations`) so the same Q&A card renders; the
 * summary is the `"question"="answer"` text the phone's count-only projection
 * parses when the input is not available.
 */
export function cursorQuestionToolPresentation(
  args: unknown,
  result: unknown,
): { input: Record<string, unknown>; summary: string | null } {
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const questions = Array.isArray(rec.questions) ? rec.questions : []
  const res = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null
  const outcome = typeof res?.outcome === 'string' ? res.outcome : null
  if (outcome === 'answered' && res?.answers && typeof res.answers === 'object') {
    const answers = res.answers as Record<string, string>
    const notes = res.notes && typeof res.notes === 'object' ? res.notes as Record<string, string> : {}
    const annotations: QuestionAnnotations = {}
    for (const [question, text] of Object.entries(notes)) annotations[question] = { notes: text }
    return {
      input: buildAnsweredQuestionInput({ questions: questions as QuestionLike[], answers, annotations }),
      summary: Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ') || null,
    }
  }
  if (outcome === 'dismissed') return { input: { questions }, summary: 'User dismissed the question without answering.' }
  if (outcome === 'cancelled') {
    return { input: { questions }, summary: `Question cancelled: ${typeof res?.reason === 'string' ? res.reason : 'turn ended'}.` }
  }
  return { input: { questions }, summary: null }
}

type QuestionLike = Parameters<typeof buildAnsweredQuestionInput>[0]['questions'][number]

/** Build the shared plan approval request from a completed `createPlan` call. */
export function buildCursorPlanApprovalRequest(requestId: string, args: unknown): PlanApprovalRequest | null {
  const rec = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const plan = typeof rec.plan === 'string' ? rec.plan.trim() : ''
  if (!plan) return null
  return { requestId, planContent: plan, planFilePath: '', allowedPrompts: [] }
}

/** Host turn text that carries a plan decision back to the Cursor agent. */
export function cursorPlanFollowUpText(decision: CursorPlanDecision): string | null {
  if (decision.kind === 'approved') {
    return decision.feedback
      ? `The user approved the plan and added: ${decision.feedback}\n\nImplement the approved plan now.`
      : 'The user approved the plan. Implement it now.'
  }
  if (decision.kind === 'rejected' && decision.feedback) {
    return `The user rejected the plan with this feedback: ${decision.feedback}\n\nRevise the plan accordingly.`
  }
  return null
}
