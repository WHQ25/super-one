import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { groupPendingPermissions } from '@superone/shared/input-request-presentation'

export type DecisionQueueItem =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'question'; request: AskUserQuestionRequest }

/** Stable order for session decisions; permissions retain the harness arrival order. */
export function buildDecisionQueue(
  permissions: PermissionRequest[],
  question: AskUserQuestionRequest | null,
): DecisionQueueItem[] {
  const { permissions: approvals, agentInputs } = groupPendingPermissions(permissions)
  return [
    ...approvals.map((request): DecisionQueueItem => ({ kind: 'permission', request })),
    ...(question ? [{ kind: 'question' as const, request: question }] : []),
    ...agentInputs.map((request): DecisionQueueItem => ({ kind: 'permission', request })),
  ]
}
