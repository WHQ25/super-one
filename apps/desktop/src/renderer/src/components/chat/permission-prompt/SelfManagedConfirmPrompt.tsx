import type { PermissionRequest } from '@superone/shared/agent-types'
import { AgentProfileConfirmPromptContainer } from '../AgentProfileConfirmPrompt'
import { AutomationConfirmPromptContainer } from '../AutomationConfirmPrompt'
import { ComputerUseGrantPrompt } from '../ComputerUseGrantPrompt'
import { ConfigConfirmPromptContainer } from '../ConfigConfirmPromptContainer'
import { InputRequestPrompt } from '../InputRequestPrompt'
import { VideoConfirmComposer } from '../media-composer/VideoConfirmComposer'
import { SessionAgentsConfirmPromptContainer } from '../SessionAgentsConfirmPromptContainer'
import { SessionCleanupConfirmPromptContainer } from '../SessionCleanupConfirmPrompt'
import { WebMcpTrustPrompt } from '../WebMcpTrustPrompt'

export function isHostConfirmRequest(request: PermissionRequest | undefined): boolean {
  const kind = request?.requestKind
  return kind === 'input_request'
    || kind === 'video_gen_confirm'
    || kind === 'config_confirm'
    || kind === 'session_agents_confirm'
    || kind === 'computer_use_grant'
    || kind === 'webmcp_trust_confirm'
    || kind === 'session_cleanup_confirm'
    || kind === 'automation_confirm'
    || kind === 'agent_profile_confirm'
}

export function SelfManagedConfirmPrompt({
  request,
  onRespond,
}: {
  request: PermissionRequest
  onRespond: (
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    feedback?: string,
    selectedSuggestions?: number[],
    decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ) => void
}) {
  const { requestId, requestKind } = request

  switch (requestKind) {
    case 'input_request':
      return <InputRequestPrompt request={request} />
    case 'video_gen_confirm':
      return request.videoGenConfirm
        ? <VideoConfirmComposer key={requestId} request={{ ...request, videoGenConfirm: request.videoGenConfirm }} />
        : null
    case 'config_confirm':
      return <ConfigConfirmPromptContainer request={request} />
    case 'session_agents_confirm':
      return <SessionAgentsConfirmPromptContainer request={request} />
    case 'session_cleanup_confirm':
      return <SessionCleanupConfirmPromptContainer request={request} />
    case 'automation_confirm':
      return <AutomationConfirmPromptContainer request={request} />
    case 'agent_profile_confirm':
      return <AgentProfileConfirmPromptContainer request={request} />
    case 'webmcp_trust_confirm':
      return (
        <WebMcpTrustPrompt
          request={request}
          onTrust={(scope) => onRespond(requestId, true, scope === 'always', undefined, undefined, undefined, { scope })}
          onDeny={() => onRespond(requestId, false)}
        />
      )
    case 'computer_use_grant':
      return (
        <ComputerUseGrantPrompt
          request={request}
          onSessionAllow={() => onRespond(requestId, true, false)}
          onAlwaysAllow={() => onRespond(requestId, true, true)}
          onDeny={() => onRespond(requestId, false)}
        />
      )
    default:
      return null
  }
}
