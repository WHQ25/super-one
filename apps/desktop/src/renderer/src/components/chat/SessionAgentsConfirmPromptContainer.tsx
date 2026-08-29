import { useScopedSessionActions } from '@/stores/chat'
import {
  SESSION_AGENT_LAUNCHES_FIELD,
  type PermissionRequest,
  type SessionAgentLaunchProposal,
} from '@superone/shared/agent-types'
import { SessionAgentsConfirmPrompt } from './SessionAgentsConfirmPrompt'

export function SessionAgentsConfirmPromptContainer({ request }: { request: PermissionRequest }) {
  const { respondToPermission } = useScopedSessionActions()
  const payload = request.sessionAgentsConfirm
  if (!payload) return null

  // `formAnswers` (the 7th arg) is the channel session.ts hands to resolveSessionAgentsConfirm
  // as `outcome.content` — the plain `reason` arg never reaches the collaboration tool.
  const respond = (allow: boolean, content: Record<string, unknown>): void => {
    void respondToPermission(request.requestId, allow, undefined, undefined, undefined, undefined, content)
  }

  const handleConfirm = (launches: SessionAgentLaunchProposal[]): void => {
    respond(true, { [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches) })
  }

  const handleReject = (feedback?: string): void => {
    respond(false, feedback ? { feedback } : {})
  }

  return <SessionAgentsConfirmPrompt payload={payload} onConfirm={handleConfirm} onReject={handleReject} />
}
