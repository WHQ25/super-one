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
  return (
    <SessionArchiveToolBlockPresenter
      {...props}
      onOpenProject={(projectPath) => useAppStore.getState().selectProject(projectPath.trim())}
      onOpenSession={openArchiveSession}
      renderHarnessIcon={(harness, acpAgentId) => {
        const Icon = resolveSessionIcon(harness || null, acpAgentId)
        return Icon
          ? <Icon status="default" size={12} renderLevel="compact" />
          : null
      }}
    />
  )
}
