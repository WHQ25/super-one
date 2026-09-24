import { randomUUID } from 'node:crypto'
import type { DeepseekQuestion } from '@superone/deepseek'
import type { AgentEvent } from '@superone/shared/agent-types'

/** What dsh receives back: the encoded answer, or the user setting it aside. */
type QuestionOutcome = ReturnType<DeepseekQuestion['answer']> | 'dismissed'

interface PendingQuestion {
  question: DeepseekQuestion
  event: AgentEvent
  settle: (outcome: QuestionOutcome) => void
}

/**
 * dsh's open questions and plan reviews, parked on SuperOne's prompts.
 *
 * Each `ask` holds one dsh tool call open until the user answers, dismisses,
 * or dsh withdraws it (the turn was cancelled). Every way out ends in
 * `interaction_resolved`, so a prompt never outlives the call it answers.
 */
export class DeepseekQuestions {
  private pending = new Map<string, PendingQuestion>()

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  ask(question: DeepseekQuestion, signal?: AbortSignal): Promise<QuestionOutcome> {
    const requestId = randomUUID()
    const event: AgentEvent = question.kind === 'plan-review'
      ? { type: 'plan_approval', request: { requestId, planContent: question.plan, planFilePath: '', allowedPrompts: [] } }
      : { type: 'ask_user_question', request: { requestId, questions: question.questions } }
    return new Promise((resolve) => {
      this.pending.set(requestId, { question, event, settle: resolve })
      signal?.addEventListener('abort', () => this.settle(requestId, 'dismissed'), { once: true })
      this.emit(event)
    })
  }

  answer(requestId: string, answers: Record<string, string>): void {
    const pending = this.pending.get(requestId)
    if (pending?.question.kind !== 'questions') return
    this.settle(requestId, pending.question.answer(answers))
  }

  /**
   * Settle a plan review.
   * @returns whether a plan review was open under that id.
   */
  review(requestId: string, approved: boolean, feedback?: string): boolean {
    const pending = this.pending.get(requestId)
    if (pending?.question.kind !== 'plan-review') return false
    this.settle(requestId, pending.question.answer(approved, feedback), { approved, feedback })
    return true
  }

  dismiss(requestId: string): void {
    this.settle(requestId, 'dismissed')
  }

  dismissAll(): void {
    for (const requestId of [...this.pending.keys()]) this.dismiss(requestId)
  }

  events(): AgentEvent[] {
    return [...this.pending.values()].map((pending) => pending.event)
  }

  private settle(requestId: string, outcome: QuestionOutcome, verdict?: { approved: boolean; feedback?: string }): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.settle(outcome)
    this.emit({
      type: 'interaction_resolved',
      interactionType: pending.question.kind === 'plan-review' ? 'plan_approval' : 'question',
      requestId,
      ...(verdict ? { approved: verdict.approved } : {}),
      ...(verdict?.feedback ? { feedback: verdict.feedback } : {}),
    })
  }
}
