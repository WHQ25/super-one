import type { ComponentType } from 'react'
import { Globe, Route, Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { openBrowserTab, openTerminalTab, openTrajectoryTab } from './activity-panel-api'

export interface ActivityLaunchType {
  id: string
  icon: ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  disabled?: boolean
  onOpen: () => void
}

const isMac = window.app.platform === 'darwin'

// The content types a user can open manually in the activity panel. Shared by the
// empty-state launcher tab and the tab-bar "+" menu so they never drift.
export function useActivityLaunchTypes(): ActivityLaunchType[] {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  // Trajectory reads a dsh session log, so it is offered only where one exists.
  // Other harnesses keep their own native transcripts; projecting those onto
  // this ledger is separate work, not a fallback.
  const trajectorySessionId = useChatStore((s) => {
    const project = s.activeProject ? s.projectSessions[s.activeProject] : undefined
    const sessionId = project?._activeSessionId
    const session = sessionId ? project?._sessions[sessionId] : undefined
    return session && resolveProvider(session) === 'dsh' ? sessionId ?? null : null
  })

  return [
    {
      id: 'browser',
      icon: Globe,
      label: t('activity.launcher.browser'),
      shortcut: isMac ? '⌘T' : 'Ctrl+T',
      onOpen: () => openBrowserTab(),
    },
    {
      id: 'terminal',
      icon: TerminalIcon,
      label: t('activity.launcher.terminal'),
      disabled: !currentFolder,
      onOpen: () => {
        const projectPath = useAppStore.getState().currentFolder
        if (!projectPath) return
        const cs = useChatStore.getState()
        const proj = cs.activeProject
        const sessionId = proj ? cs.projectSessions[proj]?._activeSessionId ?? undefined : undefined
        void openTerminalTab(projectPath, sessionId)
      },
    },
    // Absent rather than disabled on every other harness: a greyed-out row
    // reads as "you could enable this", and nothing a user does on a Claude or
    // Codex session will ever produce a dsh log to project.
    ...(trajectorySessionId === null
      ? []
      : [{
        id: 'trajectory',
        icon: Route,
        label: t('trajectory.title'),
        onOpen: () => openTrajectoryTab(trajectorySessionId, t('trajectory.title')),
      }]),
  ]
}
