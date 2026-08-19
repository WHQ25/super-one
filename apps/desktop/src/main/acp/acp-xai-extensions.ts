import type {
  AskUserQuestionRequest,
  PlanApprovalRequest,
  QuestionAnnotations,
  UserQuestion,
} from '@superone/shared/agent-types'

/** Grok ACP client methods (agent → client). */
export const XAI_ASK_USER_QUESTION = 'x.ai/ask_user_question'
export const XAI_EXIT_PLAN_MODE = 'x.ai/exit_plan_mode'
/** Client → agent: request session recap (manual `/recap` or auto return-from-away). */
export const XAI_RECAP = 'x.ai/recap'
/** Client → agent: permission/yolo baseline change for the live session. */
export const XAI_YOLO_MODE_CHANGED = 'x.ai/yolo_mode_changed'
/** Client → agent: Grok Build credits + subscription tier for the usage gauge. */
export const XAI_BILLING = 'x.ai/billing'
/** Agent → client: remote settings snapshot (may carry a consent notice). */
export const XAI_SETTINGS_UPDATE = 'x.ai/settings/update'
/** Client → agent: record that the user accepted a consent notice. */
export const XAI_CONSENT_RECORD = 'x.ai/consent/record'

/** `consent_gate` on `x.ai/settings/update`. */
export interface GrokConsentGate {
  id: string
  version: number
  title?: string
  body?: string
  acceptLabel?: string
}

/**
 * Wire name for an outgoing x.ai extension method.
 *
 * ACP routes non-standard methods by a leading `_`, and Grok only registers its
 * `x.ai/*` handlers behind that prefix — verified against `grok agent stdio`
 * 1.0.0, where the bare name answers `-32601 Method not found` for requests and
 * is dropped with `failed to decode … Method not found` for notifications. The
 * agent side strips the prefix again, so its handlers match the bare name.
 *
 * Incoming notifications are a separate matter: the JS SDK does not strip, so
 * handlers are registered for both forms.
 */
export function xaiExtWireMethod(method: string): string {
  return method.startsWith('_') ? method : `_${method}`
}

export interface GrokAskUserQuestionParams {
  sessionId?: string
  toolCallId?: string
  questions?: unknown
  [key: string]: unknown
}

export type GrokAskUserAnswer =
  | { kind: 'accepted'; answers: Record<string, string>; annotations?: QuestionAnnotations }
  | { kind: 'cancelled' }

/** Wire params for `x.ai/exit_plan_mode` (camelCase per Grok ExitPlanModeExtRequest). */
export interface GrokExitPlanModeParams {
  sessionId?: string
  toolCallId?: string
  planContent?: string | null
  [key: string]: unknown
}

/**
 * SuperOne → Grok outcome for exit_plan_mode.
 * Grok wire: `{ outcome: "approved" | "cancelled" | "abandoned", feedback? }`.
 */
export type GrokExitPlanModeAnswer =
  | { kind: 'approved' }
  | { kind: 'cancelled'; feedback?: string }
  | { kind: 'abandoned' }

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

export function parseGrokConsentGate(raw: unknown): GrokConsentGate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const nested = o.consent_gate ?? o.consentGate
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null
  const src = nested as Record<string, unknown>
  const id = typeof src.id === 'string' ? src.id.trim() : ''
  if (!id) return null
  const versionRaw = src.version
  const version = typeof versionRaw === 'number' && Number.isFinite(versionRaw)
    ? Math.trunc(versionRaw)
    : 1
  const title = typeof src.title === 'string' ? src.title.trim() : ''
  const body = typeof src.body === 'string' ? src.body.trim() : ''
  const acceptLabel = typeof src.accept_label === 'string'
    ? src.accept_label.trim()
    : typeof src.acceptLabel === 'string'
      ? src.acceptLabel.trim()
      : ''
  return {
    id,
    version,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(acceptLabel ? { acceptLabel } : {}),
  }
}

export function consentGateToAskUserQuestion(
  gate: GrokConsentGate,
  requestId: string,
): AskUserQuestionRequest {
  const title = gate.title || 'Notice'
  const question = gate.body ? `${title}\n\n${gate.body}` : title
  return {
    requestId,
    questions: [{
      question,
      header: title,
      options: [{ label: gate.acceptLabel || 'Accept', description: '' }],
      multiSelect: false,
    }],
  }
}

export function buildConsentRecordParams(gate: GrokConsentGate): { noticeId: string; version: number } {
  return { noticeId: gate.id, version: gate.version }
}

/**
 * Grok AskUserQuestionExtResponse — internally tagged on `outcome` (snake_case):
 *   `{ "outcome": "accepted", "answers": { "Q?": ["A"] }, "annotations"?: { ... } }`
 *   `{ "outcome": "cancelled" }`
 *   `{ "outcome": "chat_about_this", "partial_answers"?: { ... } }`  (plan mode)
 *   `{ "outcome": "skip_interview", "partial_answers"?: { ... } }`   (plan mode)
 *
 * Accepted answers: map question text → string[] (multi-select / single as one-element list).
 * Grok also accepts a bare string per key and normalizes to a 1-element vec.
 */
export function formatGrokAskUserResponse(answer: GrokAskUserAnswer): Record<string, unknown> {
  if (answer.kind === 'cancelled') {
    return { outcome: 'cancelled' }
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
    outcome: 'accepted',
    answers,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  }
}

/** Parse `x.ai/exit_plan_mode` params (camelCase preferred; snake_case tolerated). */
export function parseGrokExitPlanModeParams(raw: unknown): GrokExitPlanModeParams {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const sessionId =
    typeof o.sessionId === 'string' ? o.sessionId
    : typeof o.session_id === 'string' ? o.session_id
    : undefined
  const toolCallId =
    typeof o.toolCallId === 'string' ? o.toolCallId
    : typeof o.tool_call_id === 'string' ? o.tool_call_id
    : undefined
  let planContent: string | null | undefined
  if (typeof o.planContent === 'string') planContent = o.planContent
  else if (typeof o.plan_content === 'string') planContent = o.plan_content
  else if (o.planContent === null || o.plan_content === null) planContent = null
  return {
    ...o,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    ...(planContent !== undefined ? { planContent } : {}),
  }
}

export function buildPlanApprovalRequest(
  params: GrokExitPlanModeParams,
  requestId: string,
): PlanApprovalRequest {
  const planContent = typeof params.planContent === 'string' ? params.planContent : ''
  return {
    requestId,
    planContent,
    planFilePath: '',
    allowedPrompts: [],
  }
}

/** Grok ExitPlanModeExtResponse — flat `{ outcome, feedback? }`. */
export function formatGrokExitPlanModeResponse(answer: GrokExitPlanModeAnswer): Record<string, unknown> {
  if (answer.kind === 'approved') {
    return { outcome: 'approved' }
  }
  if (answer.kind === 'abandoned') {
    return { outcome: 'abandoned' }
  }
  const feedback = answer.feedback?.trim()
  return {
    outcome: 'cancelled',
    ...(feedback ? { feedback } : {}),
  }
}
