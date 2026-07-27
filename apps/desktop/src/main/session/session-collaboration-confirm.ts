import { randomUUID } from 'crypto'
import type { AgentEvent, SessionAgentRequestPayload } from '@superone/shared/agent-types'

const CONFIRM_TIMEOUT_MS = 10 * 60_000

export interface SessionAgentsConfirmOutcome {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

const pendingConfirms = new Map<string, {
  resolve: (outcome: SessionAgentsConfirmOutcome) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

export function resolveSessionAgentsConfirm(
  requestId: string,
  action: SessionAgentsConfirmOutcome['action'],
  content?: Record<string, unknown>,
): boolean {
  const pending = pendingConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingConfirms.delete(requestId)
  pending.resolve({ action, content })
  return true
}

export function rejectSessionAgentsConfirm(requestId: string, reason: string): boolean {
  const pending = pendingConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingConfirms.delete(requestId)
  pending.reject(new Error(reason))
  return true
}

export function openSessionAgentsConfirm(
  session: { emitHostEvent(event: AgentEvent): void },
  payload: SessionAgentRequestPayload,
): Promise<SessionAgentsConfirmOutcome> {
  const requestId = `sessionagents_${Date.now()}_${randomUUID().slice(0, 8)}`
  return new Promise<SessionAgentsConfirmOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConfirms.delete(requestId)
      reject(new Error('Agent session request timed out'))
    }, CONFIRM_TIMEOUT_MS)
    pendingConfirms.set(requestId, { resolve, reject, timer })
    session.emitHostEvent({
      type: 'permission_request',
      request: {
        requestId,
        toolName: 'session_collab_request',
        toolUseId: requestId,
        input: {},
        allowAlwaysAllow: false,
        requestKind: 'session_agents_confirm',
        serverName: 'superone',
        message: 'Allow this agent to start the following sessions?',
        sessionAgentsConfirm: payload,
      },
    })
  })
}
