import type { ComponentType } from 'react'
import { Globe, Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { openBrowserTab, openTerminalTab } from './activity-panel-api'

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
  ]
}
