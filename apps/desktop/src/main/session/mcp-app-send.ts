import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { NodeHostSessionManager } from '../node-host/desktop-session-host'
import { admitDesktopSessionSend } from '../node-host/desktop-session-mutations'
import { currentControlScope } from './control-context'

/** Native phone admission for an approved View message, with the caller's exact grant. */
export async function sendPhoneMcpAppMessage(manager: NodeHostSessionManager, input: {
  sessionId: string
  projectPath: string
  request: SendMessageRequest
}, source: { deviceId: string; transport: 'lan' | 'relay' }, onAccepted: () => void): Promise<void> {
  const scope = currentControlScope()
  if (scope?.clientSessionId !== `phone:${source.deviceId}`) throw Object.assign(new Error('Authenticated phone control required'), { code: 'forbidden' })
  const session = manager.getSession(input.sessionId) ?? manager.resumeSession(input.sessionId, { passive: true })
  if (session.projectPath !== input.projectPath) throw Object.assign(new Error('Session does not belong to this project'), { code: 'forbidden' })
  session.lease.assertMutation()
  const proof = scope.proofs.get(input.sessionId)!
  await admitDesktopSessionSend(session, input.request, {
    sessionId: input.sessionId, client: { clientSessionId: scope.clientSessionId }, ...proof,
    text: input.request.content, clientMessageId: input.request.clientMessageId, priority: input.request.priority,
  })
  onAccepted()
}
