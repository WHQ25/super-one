import type { PendingInteraction, QuestionAnswers } from '@superone/runtime/session'
import { mapOpenCodeV2FormRequest } from './opencode-v2-event-map'
import type { OpenCodeV2Form } from './opencode-v2-types'

/** Controller labels are presentation; native fields retain their own values. */
export async function answerOpenCodeForm(
  form: OpenCodeV2Form,
  ask: (request: PendingInteraction) => Promise<QuestionAnswers>,
) {
  if (form.fields.some((field) => field.type === 'external'))
    throw new Error('This native OpenCode form requires an unsupported external field')
  const request = mapOpenCodeV2FormRequest(form)
  const raw = await ask({
    interactionId: form.id,
    kind: 'question',
    toolName: 'AskUserQuestion',
    input: { questions: request.questions },
    createdAt: Date.now(),
  })
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) return null
  return request.questions.map((question, index) => {
    const value = Array.isArray(raw)
      ? raw[index]
      : ((raw as Record<string, unknown>)[question.question] ?? (raw as Record<string, unknown>)[question.header])
    return Array.isArray(value)
      ? value.map(String)
      : typeof value === 'string'
        ? question.multiSelect
          ? value.split(', ')
          : [value]
        : []
  })
}
