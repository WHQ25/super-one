/**
 * Host confirm for agent_profile_apply / agent_profile_delete. Kept apart from
 * the handlers so Session can resolve it without loading the profile catalog.
 */

import { HostConfirmRegistry } from '../session/host-confirm-registry'

const CONFIRM_TIMEOUT_MS = 10 * 60_000

export type ConfirmOutcome = { action: 'accept' | 'decline' | 'cancel'; feedback?: string }

export const profileConfirms = new HostConfirmRegistry<ConfirmOutcome>({
  idPrefix: 'agentprofileconfirm',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Agent profile confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveAgentProfileConfirm(requestId: string, action: string, content?: Record<string, unknown>): boolean {
  const feedback = typeof content?.feedback === 'string' && content.feedback.trim() ? content.feedback.trim() : undefined
  return profileConfirms.settle(requestId, action === 'accept', {
    action: action as ConfirmOutcome['action'],
    ...(feedback ? { feedback } : {}),
  })
}

export function rejectAgentProfileConfirm(requestId: string, reason: string): boolean {
  return profileConfirms.fail(requestId, new Error(reason))
}

export function _resetAgentProfileConfirmsForTests(): void {
  profileConfirms.clearForTests()
}
