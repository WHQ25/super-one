/**
 * AskUserQuestion branch of `canUseTool`, shared by the one-shot turn runner
 * (`run-sdk-turn`) and the long-lived `ClaudeLiveSession`.
 *
 * Besides handing the answered input back to the SDK, this re-emits the tool_use
 * block: the SDK streamed it with the model's original input before `canUseTool`
 * ran and never revisits it, so without the delta the answered tool card has no
 * answers and no option preview to render. See `@superone/shared/ask-user-question`.
 */

import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, QuestionAnnotations } from '@superone/shared/agent-types'
import {
  answeredQuestionDelta,
  asQuestionPreviewFormat,
  buildAnsweredQuestionInput,
} from '@superone/shared/ask-user-question'
import type { ClaudeQuestionHandler } from './types'

type PermissionResult = Awaited<ReturnType<CanUseTool>>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function resolveAskUserQuestion(params: {
  onQuestion: ClaudeQuestionHandler | undefined
  interactionId: string
  toolName: string
  toolUseId?: string
  input: unknown
  /** Node-local `toolConfig.askUserQuestion.previewFormat`; markdown when unset. */
  previewFormat?: string
  emitAgentEvent?: (event: AgentEvent) => void
  getMessageId?: () => string | undefined
}): Promise<PermissionResult> {
  const { onQuestion, interactionId, toolName, toolUseId, input } = params
  if (!onQuestion) {
    return { behavior: 'deny', message: 'Question denied by SuperOne node (no question handler)' }
  }
  // Stamp the format the model was asked for onto the input: it rides the existing
  // pendingInteraction.input channel, so the answering client knows whether an
  // option preview is HTML without a protocol field of its own.
  const previewFormat = asQuestionPreviewFormat(params.previewFormat)
  const rawInput = asRecord(input)
  const baseInput: Record<string, unknown> | null = rawInput
    ? { ...rawInput, ...(previewFormat ? { previewFormat } : {}) }
    : null
  const answer = await onQuestion({
    interactionId,
    kind: 'question',
    toolName,
    toolUseId,
    input: baseInput ?? undefined,
  })
  const record = asRecord(answer)
  // Legacy hosts resolve with the bare answers map; newer ones with { answers, annotations }.
  const answers = record && 'answers' in record ? record.answers : answer
  const answerMap = asRecord(answers) as Record<string, string> | null

  const updatedInput: Record<string, unknown> = {
    ...baseInput,
    ...buildAnsweredQuestionInput({
      questions: Array.isArray(baseInput?.questions) ? baseInput.questions : [],
      answers: answerMap ?? {},
      annotations: record?.annotations as QuestionAnnotations | undefined,
      previewFormat,
    }),
    // Preserve the host's answer shape verbatim — it is not always a record.
    answers,
  }

  const messageId = params.getMessageId?.()
  if (messageId && toolUseId && params.emitAgentEvent) {
    params.emitAgentEvent(answeredQuestionDelta(messageId, toolUseId, updatedInput))
  }

  return { behavior: 'allow', updatedInput }
}
