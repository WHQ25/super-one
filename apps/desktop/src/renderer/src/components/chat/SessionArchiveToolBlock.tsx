import { resolveSessionLink } from '@superone/shared/session-link'
import { desktopSessionLinkPorts, openSessionLink, sessionLinkSource } from '@/lib/session-links'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import {
  SessionArchiveToolBlockPresenter,
  isSessionArchiveToolName,
  type SessionArchiveToolBlockPresenterProps,
  type SessionArchiveToolName,
} from '@superone/chat-view/presenters/SessionArchiveToolBlock'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { resolveProjectPathForOpen } from '@/lib/resolve-project-path'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export { isSessionArchiveToolName, type SessionArchiveToolName }

export type SessionArchiveToolBlockProps = Omit<
  SessionArchiveToolBlockPresenterProps,
  'onOpenProject' | 'onOpenSession' | 'renderHarnessIcon'
>

async function openArchiveSession(sessionId: string, projectId?: string | null) {
  if (!sessionId) return
  const target = await resolveProjectPathForOpen(projectId, useChatStore.getState().activeProject)
  if (!target) return
  if (useMosaicStore.getState().focusOrReplaceFocused(target, sessionId)) return
  await useChatStore.getState().switchToSession(target, sessionId)
}

/** Desktop adapter for project/session navigation and harness branding. */
export function SessionArchiveToolBlock(props: SessionArchiveToolBlockProps) {
  const scope = useSessionScope()
  const sourceProject = scope?.projectPath
  const open = async (sessionId: string, projectId?: string | null, environmentId?: string) => {
    try {
    if (!environmentId) return openArchiveSession(sessionId, projectId)
    const source = sourceProject ? await sessionLinkSource(sourceProject) : null
    const ref = resolveSessionLink({ sessionId, environmentId }, source)
    if (!ref) throw new Error('Session source environment unavailable')
    await openSessionLink(ref)
    } catch (error) { desktopSessionLinkPorts.onError(error) }
  }
  return (
    <SessionArchiveToolBlockPresenter
      {...props}
      onOpenProject={(projectPath) => useAppStore.getState().selectProject(projectPath.trim())}
      onOpenSession={open}
      renderHarnessIcon={(harness, acpAgentId) => {
        const Icon = resolveSessionIcon(harness || null, acpAgentId)
        return Icon
          ? <Icon status="default" size={12} renderLevel="compact" />
          : null
      }}
    />
  )
}
