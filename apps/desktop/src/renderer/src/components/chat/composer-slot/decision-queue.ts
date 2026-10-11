import type {
  AskUserQuestionRequest,
  ChatMessage,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { groupPendingPermissions } from '@superone/shared/input-request-presentation'
import { codexAsyncQuestionQueue, type PendingCodexAsyncQuestion } from '@superone/shared/codex-async-question'

export type DecisionQueueItem =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'question'; request: AskUserQuestionRequest }
  | { kind: 'async-question'; request: AskUserQuestionRequest; question: PendingCodexAsyncQuestion }

/** Stable order for session decisions; permissions retain the harness arrival order. */
export function buildDecisionQueue(
  permissions: PermissionRequest[],
  question: AskUserQuestionRequest | null,
  messages: readonly ChatMessage[] = [],
  pendingAsyncQuestions?: PendingCodexAsyncQuestion[],
): DecisionQueueItem[] {
  const { permissions: approvals, agentInputs } = groupPendingPermissions(permissions)
  return [
    ...approvals.map((request): DecisionQueueItem => ({ kind: 'permission', request })),
    ...(question ? [{ kind: 'question' as const, request: question }] : []),
    ...codexAsyncQuestionQueue({ messages, pendingAsyncQuestions }).map((question): DecisionQueueItem => ({ kind: 'async-question', request: question.request, question })),
    ...agentInputs.map((request): DecisionQueueItem => ({ kind: 'permission', request })),
  ]
}
