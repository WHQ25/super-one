import type { AskUserQuestionRequest, QuestionAnnotations, UserQuestion } from '@superone/shared/agent-types'

/** Grok ACP client methods (agent → client). */
export const XAI_ASK_USER_QUESTION = 'x.ai/ask_user_question'
export const XAI_EXIT_PLAN_MODE = 'x.ai/exit_plan_mode'

export interface GrokAskUserQuestionParams {
  sessionId?: string
  toolCallId?: string
  questions?: unknown
  [key: string]: unknown
}

export type GrokAskUserAnswer =
  | { kind: 'accepted'; answers: Record<string, string>; annotations?: QuestionAnnotations }
  | { kind: 'cancelled' }

/** Normalize Grok/Claude-shaped question list into SuperOne UserQuestion[]. */
export function normalizeGrokQuestions(raw: unknown): UserQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: UserQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const q = item as Record<string, unknown>
    const question = typeof q.question === 'string' ? q.question.trim() : ''
    if (!question) continue
    const optionsRaw = Array.isArray(q.options) ? q.options : []
    const options = optionsRaw
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o))
      .map((o) => ({
        label: typeof o.label === 'string' ? o.label : String(o.label ?? ''),
        description: typeof o.description === 'string' ? o.description : '',
        ...(typeof o.preview === 'string' && o.preview ? { preview: o.preview } : {}),
      }))
      .filter((o) => o.label.length > 0)
    const multiSelect = q.multiSelect === true || q.multi_select === true
    const header =
      typeof q.header === 'string' && q.header.trim()
        ? q.header.trim()
        : question.length > 24
          ? `${question.slice(0, 24)}…`
          : question
    out.push({ question, header, options, multiSelect })
  }
  return out
}

export function buildAskUserQuestionRequest(
  params: GrokAskUserQuestionParams,
  requestId: string,
): AskUserQuestionRequest {
  return {
    requestId,
    questions: normalizeGrokQuestions(params.questions),
  }
}

/**
 * Grok expects externally-tagged ExtResponse.
 * Accepted carries answers as map question → string[] (multi-select / single as one-element list).
 */
export function formatGrokAskUserResponse(answer: GrokAskUserAnswer): Record<string, unknown> {
  if (answer.kind === 'cancelled') {
    return { cancelled: {} }
  }
  const answers: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(answer.answers)) {
    if (!value) continue
    // multi-select may already be comma-joined by SuperOne UI — keep as single entry;
    // Grok multi_select expects list of selected labels when multiSelect is true.
    answers[key] = value.includes(', ') ? value.split(', ').map((s) => s.trim()).filter(Boolean) : [value]
  }
  const annotations: Record<string, { preview?: string; notes?: string }> = {}
  if (answer.annotations) {
    for (const [key, ann] of Object.entries(answer.annotations)) {
      if (!ann) continue
      const entry: { preview?: string; notes?: string } = {}
      if (ann.preview) entry.preview = ann.preview
      if (ann.notes) entry.notes = ann.notes
      if (entry.preview || entry.notes) annotations[key] = entry
    }
  }
  return {
    accepted: {
      answers,
      partial_answers: {},
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    },
  }
}
