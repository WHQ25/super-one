import { useLayoutEffect, useMemo, useRef } from 'react'
import { useActiveSession } from '@/stores/chat'
import { ModQuestionSite } from '@superone/chat-view/mod-ui'
import { useChatRootRef } from './is-focus-in-chat'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { PermissionPrompt } from './PermissionPrompt'
import { isHighRiskPermission, setDecisionKeyboardPolicy } from './composer-slot/decision-composer-policy'
import { buildDecisionQueue, type DecisionQueueItem } from './composer-slot/decision-queue'

export function DecisionComposer({ item }: { item?: DecisionQueueItem | null }) {
  const pendingPermissions = useActiveSession((s) => s.pendingPermissions)
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const chatRootRef = useChatRootRef()
  const containerRef = useRef<HTMLDivElement>(null)
  const queue = useMemo(
    () => buildDecisionQueue(pendingPermissions ?? [], pendingQuestion ?? null),
    [pendingPermissions, pendingQuestion],
  )
  const current = item === undefined ? queue[0] : item
  const requestKey = current ? `${current.kind}:${current.request.requestId}` : null
  const liveKey = queue[0] ? `${queue[0].kind}:${queue[0].request.requestId}` : null
  const stale = requestKey !== liveKey
  const requireExplicitApproval = current?.kind === 'permission' && isHighRiskPermission(current.request)

  useLayoutEffect(() => {
    const root = chatRootRef?.current ?? containerRef.current?.closest<HTMLElement>('[data-chat-root]')
    if (!root || !requestKey) return
    return setDecisionKeyboardPolicy(root, requestKey, requireExplicitApproval)
  }, [chatRootRef, requestKey, requireExplicitApproval])

  if (!current) return null

  return (
    <div ref={containerRef} inert={stale} data-testid="decision-composer" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div key={requestKey} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {current.kind === 'permission' ? (
          <PermissionPrompt request={current.request} />
        ) : (
          <ModQuestionSite request={current.request}>
            <AskUserQuestionPrompt request={current.request} />
          </ModQuestionSite>
        )}
      </div>
    </div>
  )
}
