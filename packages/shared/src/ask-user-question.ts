/**
 * AskUserQuestion answered-input plumbing, shared by every host that owns a
 * `canUseTool` callback (desktop ClaudeBackend, remote node ClaudeLiveSession).
 *
 * The Agent SDK streams the tool_use block with the model's ORIGINAL input long
 * before `canUseTool` runs, and never re-emits it — so the `updatedInput` we return
 * reaches the tool executor but not the UI. Every host must therefore do two things
 * with the same payload: hand it back to the SDK, and re-emit it as a content_delta
 * so the answered tool card can render the Q&A plus the selected option's preview.
 */

import type { AgentEvent, QuestionAnnotations, QuestionPreviewFormat } from './agent-types'

/** Narrow a config-sourced string onto the SDK's `toolConfig` union; undefined = SDK default. */
export function asQuestionPreviewFormat(value: string | undefined | null): QuestionPreviewFormat | undefined {
  const v = value?.trim()
  return v === 'markdown' || v === 'html' ? v : undefined
}

/** Structural shape of a question as it arrives in the raw tool input (unvalidated). */
interface QuestionLike {
  question: string
  multiSelect?: boolean
  options?: Array<{ label: string; preview?: string }>
}

/**
 * Assemble the AskUserQuestion tool input for an answered question, folding the
 * selected option's `preview` into the per-question annotations.
 *
 * For multiSelect the answer is a ", "-joined list of labels — mirror the live
 * preview panel, which shows the LAST selected option's preview.
 */
export function buildAnsweredQuestionInput(params: {
  questions: QuestionLike[]
  answers: Record<string, string>
  /** Client-supplied annotations (free-text notes); preview is merged on top. */
  annotations?: QuestionAnnotations
  previewFormat?: QuestionPreviewFormat | string
}): Record<string, unknown> {
  const { questions, answers, previewFormat } = params
  const annotations: QuestionAnnotations = { ...params.annotations }
  for (const q of questions) {
    const answer = answers[q.question]
    if (!answer) continue
    const lastLabel = q.multiSelect ? answer.split(', ').pop() : answer
    const selected = q.options?.find((o) => o.label === lastLabel)
    if (selected?.preview) {
      annotations[q.question] = { ...annotations[q.question], preview: selected.preview }
    }
  }
  return {
    questions,
    answers,
    ...(Object.keys(annotations).length > 0 && { annotations }),
    ...(previewFormat ? { previewFormat } : {}),
  }
}

/**
 * The content_delta that back-fills the already-streamed tool_use block.
 *
 * `parentToolUseId` is deliberately omitted: applyContentDelta merges by toolUseId
 * with `{ ...existing, ...delta }`, so leaving the key out preserves a sub-agent
 * block's original parent instead of re-homing it into the main conversation.
 */
export function answeredQuestionDelta(
  messageId: string,
  toolUseId: string,
  input: Record<string, unknown>,
): Extract<AgentEvent, { type: 'content_delta' }> {
  return {
    type: 'content_delta',
    messageId,
    delta: {
      type: 'tool_use',
      toolName: 'AskUserQuestion',
      toolUseId,
      input: JSON.stringify(input),
    },
  }
}
