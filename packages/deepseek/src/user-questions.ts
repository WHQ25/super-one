/**
 * dsh's user questions in SuperOne's vocabulary.
 *
 * Both `ask_user_question` and `exit_plan_mode` reach the host through one dsh
 * seam, the `user-questions/request` waterfall. A plan submitted for review is
 * a question carrying the `plan-review` intent — a presentation hint, not a
 * different protocol — so this module decides which SuperOne surface a request
 * belongs on and encodes the answer back into dsh's shape. Keeping the
 * translation here leaves the desktop backend with SuperOne's contract only.
 */

import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import type { UserQuestion } from '@superone/shared/agent-types'

/** The separator SuperOne's question prompt joins multi-select labels with. */
const MULTI_SELECT_SEPARATOR = ', '

/** A request, shaped for the SuperOne surface that should answer it. */
export type DeepseekQuestion =
  | {
      kind: 'questions'
      questions: UserQuestion[]
      /**
       * Encode the prompt's answers — keyed by question text, multi-select
       * labels joined, free text replacing a selection — into dsh's answer.
       */
      answer(answers: Record<string, string>): AskUserQuestionAnswer
    }
  | {
      kind: 'plan-review'
      /** The plan markdown the agent submitted. */
      plan: string
      answer(approved: boolean, feedback?: string): AskUserQuestionAnswer
    }

/**
 * Route one dsh request to the surface that renders it.
 * @param items - the questions dsh asked.
 * @returns the SuperOne-shaped request and its answer encoder.
 */
export function presentQuestions(items: readonly AskUserQuestionItem[]): DeepseekQuestion {
  const review = items.length === 1 ? items[0] : undefined
  if (review?.intent?.kind === 'plan-review') return planReview(review, review.intent.approve)
  return {
    kind: 'questions',
    questions: items.map((item) => ({
      // `detail` is supporting text dsh keeps out of the option labels; the
      // prompt has one text slot, so it follows the question there.
      question: item.detail ? `${item.question}\n\n${item.detail}` : item.question,
      header: item.header ?? '',
      options: (item.options ?? []).map((option) => ({ label: option.label, description: option.description ?? '' })),
      multiSelect: item.multiSelect === true,
    })),
    answer(answers) {
      return {
        answers: items.map((item) => {
          const key = item.detail ? `${item.question}\n\n${item.detail}` : item.question
          return encodeAnswer(item, answers[key] ?? '')
        }),
      }
    },
  }
}

function planReview(item: AskUserQuestionItem, approve: string): DeepseekQuestion {
  // Every option but `approve` declines; dsh names the verdict by label, never
  // by position. A question offering no other option still has to be
  // declinable, and an empty selection with feedback is how dsh reads that.
  const decline = item.options?.find((option) => option.label !== approve)?.label
  return {
    kind: 'plan-review',
    plan: item.detail ?? item.question,
    answer(approved, feedback) {
      const selected = approved ? [approve] : decline !== undefined ? [decline] : []
      return {
        answers: [{
          id: item.id,
          selected,
          ...(!approved && feedback ? { custom: feedback } : {}),
        }],
      }
    },
  }
}

/**
 * One prompt answer back into selected labels and free text.
 *
 * The prompt returns a single string per question: the chosen label(s), or
 * the "Other" text in their place. Labels are recognised against the options
 * dsh offered; anything else is the user's own words.
 */
function encodeAnswer(item: AskUserQuestionItem, value: string): AskUserQuestionAnswer['answers'][number] {
  const labels = new Set((item.options ?? []).map((option) => option.label))
  if (labels.has(value)) return { id: item.id, selected: [value] }
  if (item.multiSelect === true) {
    const parts = value.split(MULTI_SELECT_SEPARATOR)
    if (parts.length > 0 && parts.every((part) => labels.has(part))) return { id: item.id, selected: parts }
  }
  return value.length > 0 ? { id: item.id, selected: [], custom: value } : { id: item.id, selected: [] }
}
