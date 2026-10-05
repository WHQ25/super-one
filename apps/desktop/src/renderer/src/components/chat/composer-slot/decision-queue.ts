import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@superone/shared/agent-types'

export type DecisionQueueItem =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'question'; request: AskUserQuestionRequest }

/** Stable order for session decisions; permissions retain the harness arrival order. */
export function buildDecisionQueue(
  permissions: PermissionRequest[],
  question: AskUserQuestionRequest | null,
): DecisionQueueItem[] {
  return [
    ...permissions.map((request): DecisionQueueItem => ({ kind: 'permission', request })),
    ...(question ? [{ kind: 'question' as const, request: question }] : []),
  ]
}
