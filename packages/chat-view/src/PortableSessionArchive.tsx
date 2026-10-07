import { useContext } from 'react'
import { resolveSessionLink } from '@superone/shared/session-link'
import { requestNative, requestNativeAsync } from './bridge'
import { PortableTurnContext } from './portable-turn-context'
import { SessionArchiveToolBlockPresenter, type SessionArchiveToolBlockPresenterProps } from './presenters/SessionArchiveToolBlock'

export function PortableSessionArchive(props: SessionArchiveToolBlockPresenterProps) {
  const { sourceEnvironmentId } = useContext(PortableTurnContext)
  return <SessionArchiveToolBlockPresenter {...props} onOpenSession={async (sessionId, _projectId, environmentId) => {
    try {
      if (!environmentId) { await requestNativeAsync('openSession', { sessionId }); return }
      const ref = resolveSessionLink({ sessionId, environmentId }, sourceEnvironmentId)
      if (!ref) throw new Error('Session source environment unavailable')
      await requestNativeAsync('openSessionLink', { ref }, 120_000)
    } catch (error) { requestNative('sessionLinkError', { message: error instanceof Error ? error.message : 'Could not open session' }) }
  }} />
}
