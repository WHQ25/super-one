import { SessionProviderState as ProviderState } from '@superone/chat-view/SessionProviderState'
import { useActiveSession, useChatStore, useSessionScope, useIsRemoteLocked } from '@/stores/chat'
import { callSession } from '@/lib/session-client'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'

/** Scoped session RPCs keep native pending input on its owning environment. */
export function SessionProviderState() {
  const scope = useSessionScope()
  const project = useChatStore((state) => state.activeProject)
  const inbox = useActiveSession((state) => state.sessionInbox)
  const connection = useActiveSession((state) => state.harnessConnection)
  const sessionId = useActiveSession((state) => scope?.sessionId ?? state._activeSessionId)
  const path = scope?.projectPath ?? project
  const canCancel = useEnvironmentServes(path, 'session.inbox.cancel')
  const canUpdate = useEnvironmentServes(path, 'session.inbox.update')
  const locked = useIsRemoteLocked()
  return <ProviderState items={inbox} connection={connection} disabled={locked || !canCancel || !canUpdate}
    onReconnect={async () => {
      if (!path || !sessionId) throw new Error('No active session')
      if (!(await callSession(path, sessionId, 'session.connection.reconnect', {})).ok) throw new Error('This session is not connected to an agent')
    }}
    onAction={async (inboxId, action) => {
      if (!path || !sessionId) throw new Error('No active session')
      if (action === 'cancel') await callSession(path, sessionId, 'session.inbox.cancel', { inboxId })
      else await callSession(path, sessionId, 'session.inbox.update', { inboxId, delivery: action })
    }} />
}
