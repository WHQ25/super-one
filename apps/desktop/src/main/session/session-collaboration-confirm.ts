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
  session: { emitHostEvent(event: AgentEvent): void }
  signal?: AbortSignal
  onAbort?: () => void
}>()

function takePendingConfirm(requestId: string) {
  const pending = pendingConfirms.get(requestId)
  if (!pending) return undefined
  clearTimeout(pending.timer)
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort)
  }
  pendingConfirms.delete(requestId)
  return pending
}

function emitConfirmResolved(
  pending: NonNullable<ReturnType<typeof takePendingConfirm>>,
  requestId: string,
  approved: boolean,
): void {
  pending.session.emitHostEvent({
    type: 'interaction_resolved',
    interactionType: 'permission',
    requestId,
    approved,
  })
}

export function resolveSessionAgentsConfirm(
  requestId: string,
  action: SessionAgentsConfirmOutcome['action'],
  content?: Record<string, unknown>,
): boolean {
  const pending = takePendingConfirm(requestId)
  if (!pending) return false
  emitConfirmResolved(pending, requestId, action === 'accept')
  pending.resolve({ action, content })
  return true
}

export function rejectSessionAgentsConfirm(requestId: string, reason: string): boolean {
  const pending = takePendingConfirm(requestId)
  if (!pending) return false
  emitConfirmResolved(pending, requestId, false)
  pending.reject(new Error(reason))
  return true
}

export function openSessionAgentsConfirm(
  session: { emitHostEvent(event: AgentEvent): void },
  payload: SessionAgentRequestPayload,
  signal?: AbortSignal,
): Promise<SessionAgentsConfirmOutcome> {
  if (signal?.aborted) return Promise.reject(new Error('Agent session request cancelled'))
  const requestId = `sessionagents_${Date.now()}_${randomUUID().slice(0, 8)}`
  return new Promise<SessionAgentsConfirmOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      rejectSessionAgentsConfirm(requestId, 'Agent session request timed out')
    }, CONFIRM_TIMEOUT_MS)
    const onAbort = () => {
      rejectSessionAgentsConfirm(requestId, 'Agent session request cancelled')
    }
    pendingConfirms.set(requestId, { resolve, reject, timer, session, signal, onAbort })
    signal?.addEventListener('abort', onAbort, { once: true })
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
