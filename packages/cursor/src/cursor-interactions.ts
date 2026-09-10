import type {
  AgentEvent,
  AskUserQuestionRequest,
  PlanApprovalRequest,
  QuestionAnnotations,
  UserQuestion,
} from '@superone/shared/agent-types'

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
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user.' },
          header: { type: 'string', description: 'Short label (≤ 12 chars) shown as the question chip.' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
            },
          },
          multiSelect: { type: 'boolean', description: 'Allow more than one option to be selected.' },
        },
        required: ['question', 'options'],
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const

/**
 * Normalize loosely-typed tool args into the shared `AskUserQuestionRequest`.
 * Returns null when nothing askable survives (no question text or fewer than
 * two options), so the tool can answer the model with a usage error instead
 * of parking an empty prompt in the UI.
 */
export function buildCursorAskUserQuestionRequest(
  requestId: string,
  args: unknown,
): AskUserQuestionRequest | null {
  const rec = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const rawQuestions = Array.isArray(rec.questions) ? rec.questions : []
  const questions: UserQuestion[] = []
  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (!question) continue
    const options = (Array.isArray(row.options) ? row.options : [])
      .flatMap((opt) => {
        if (!opt || typeof opt !== 'object') return []
        const o = opt as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label.trim() : ''
        if (!label) return []
        return [{ label, description: typeof o.description === 'string' ? o.description : '' }]
      })
    if (options.length < 2) continue
    questions.push({
      question,
      header: typeof row.header === 'string' && row.header.trim() ? row.header.trim() : question.slice(0, 12),
      options,
      multiSelect: row.multiSelect === true,
    })
  }
  if (questions.length === 0) return null
  return { requestId, questions }
}

/** Serialize the user's answer for the model (custom tool result payload). */
export function formatCursorQuestionResult(answer: CursorQuestionAnswer): Record<string, unknown> {
  if (answer.kind === 'answered') {
    const answers: Record<string, string> = {}
    for (const [key, value] of Object.entries(answer.answers)) {
      if (value) answers[key] = value
    }
    return { outcome: 'answered', answers }
  }
  if (answer.kind === 'dismissed') {
    return { outcome: 'dismissed', note: 'The user dismissed the question without answering. Proceed with your best judgment.' }
  }
  return { outcome: 'cancelled', reason: answer.reason }
}

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
