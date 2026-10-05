import { useLayoutEffect, useRef } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { selectPendingPermission } from '@superone/shared/input-request-presentation'
import { useActiveSession, useSessionScope } from '@/stores/chat'
import { useHasMcpAppConsent } from '@/components/mcp-apps/consent-store'
import { useDecisionComposerAvailability } from './composer-slot/useDecisionComposerAvailability'
import { setDecisionKeyboardPolicy } from './composer-slot/decision-composer-policy'
import { useChatRootRef } from './is-focus-in-chat'
import { InputRequestPrompt } from './InputRequestPrompt'

/** App forms occupy the slot only after decisions, plans and app consent. */
export function InputRequestComposer({ request }: { request?: PermissionRequest | null }) {
  const pending = useActiveSession(session => session.pendingPermissions)
  const question = useActiveSession(session => !!session.pendingQuestion)
  const plan = useActiveSession(session => !!session.pendingPlanApproval)
  const scope = useSessionScope()
  const sessionId = useActiveSession(session => scope?.sessionId ?? session._activeSessionId)
  const appConsent = useHasMcpAppConsent(sessionId ?? '')
  const available = useDecisionComposerAvailability()
  const live = selectPendingPermission(pending, { question, plan, appConsent })
  const active = available && !!request && live?.requestId === request.requestId
  const chatRootRef = useChatRootRef()
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = chatRootRef?.current ?? rootRef.current?.closest<HTMLElement>('[data-chat-root]')
    if (root && active && request) return setDecisionKeyboardPolicy(root, `input:${request.requestId}`, false)
  }, [chatRootRef, request?.requestId, active])
  if (!request) return null
  return (
    <div ref={rootRef} inert={!active} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <InputRequestPrompt request={request} active={active} />
    </div>
  )
}
