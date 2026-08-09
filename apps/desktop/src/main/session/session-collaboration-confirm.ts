import type { AgentEvent, SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { HostConfirmRegistry } from './host-confirm-registry'

const CONFIRM_TIMEOUT_MS = 10 * 60_000

export interface SessionAgentsConfirmOutcome {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

const confirms = new HostConfirmRegistry<SessionAgentsConfirmOutcome>({
  idPrefix: 'sessionagents',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error('Agent session request timed out'),
})

export function resolveSessionAgentsConfirm(
  requestId: string,
  action: SessionAgentsConfirmOutcome['action'],
  content?: Record<string, unknown>,
): boolean {
  return confirms.settle(requestId, action === 'accept', { action, content })
}

export function rejectSessionAgentsConfirm(requestId: string, reason: string): boolean {
  return confirms.fail(requestId, new Error(reason))
}

export function openSessionAgentsConfirm(
  session: { emitHostEvent(event: AgentEvent): void },
  payload: SessionAgentRequestPayload,
  signal?: AbortSignal,
): Promise<SessionAgentsConfirmOutcome> {
  return confirms.open(
    session,
    (requestId) => ({
      requestId,
      toolName: 'session_collab_request',
      toolUseId: requestId,
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      serverName: 'superone',
      message: 'Allow this agent to start the following sessions?',
      sessionAgentsConfirm: payload,
    }),
    { signal, abortError: () => new Error('Agent session request cancelled') },
  )
}
