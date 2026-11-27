import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Globe, Puzzle, Smartphone, Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useClientKernelOptional } from '@superone/client-kernel/react'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { getAppClientKernel } from '@/lib/client-kernel'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { focusActivePanelContent, openBrowserTab, openDeviceTab, openTerminalTab } from './activity-panel-api'

export interface ActivityLaunchType {
  id: string
  icon: ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  disabled?: boolean
  onOpen: () => void
}

const isMac = window.app.platform === 'darwin'

export function useActivityLaunchTypes(): ActivityLaunchType[] {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const activeSessionId = useChatStore((s) => {
    const project = s.activeProject ? s.projectSessions[s.activeProject] : undefined
    return project?._activeSessionId ?? null
  })
  const activeSessionProvider = useChatStore((s) => {
    const project = s.activeProject ? s.projectSessions[s.activeProject] : undefined
    const sessionId = project?._activeSessionId
    const session = sessionId ? project?._sessions[sessionId] : undefined
    return session ? resolveProvider(session) : null
  })

  const supportsSwarmBoard = Boolean(activeSessionProvider && HARNESS_CAPABILITIES[activeSessionProvider].supportsSwarmBoard)

  const hasSwarmInMessages = useChatStore((s) => {
    if (!supportsSwarmBoard || !activeSessionId) return false
    const project = s.activeProject ? s.projectSessions[s.activeProject] : undefined
    const session = project?._sessions[activeSessionId]
    if (!session) return false
    for (const msg of session.messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        if (
          block.toolName === 'ReadBoard' ||
          block.toolName === 'PostMessage' ||
          block.toolName === 'SwarmWait' ||
          block.toolName === 'read_board' ||
          block.toolName === 'post_message' ||
          block.toolName === 'swarm_wait'
        ) {
          return true
        }
        if ((block.toolName === 'Agent' || block.toolName === 'Task') && block.input.includes('"isSwarmWorker":true')) {
          return true
        }
      }
    }
    return false
  })

  const [diskHasSwarm, setDiskHasSwarm] = useState(false)
  useEffect(() => {
    if (!supportsSwarmBoard || !activeSessionId || hasSwarmInMessages) {
      setDiskHasSwarm(false)
      return
    }
    if (typeof window.app?.readSwarmBoard !== 'function') return
    let cancelled = false
    void window.app.readSwarmBoard(activeSessionId).then((res) => {
      if (!cancelled) setDiskHasSwarm(Boolean(res?.ok))
    }).catch(() => {
      if (!cancelled) setDiskHasSwarm(false)
    })
    return () => {
      cancelled = true
    }
  }, [supportsSwarmBoard, activeSessionId, hasSwarmInMessages])

  const hasSwarm = hasSwarmInMessages || diskHasSwarm

  const kernel = useClientKernelOptional() ?? getAppClientKernel()
  const launcherMenuCtx = useMemo(
    () => ({
      menuId: 'activity.launcher' as const,
      sessionId: activeSessionId,
      projectPath: currentFolder ?? null,
      provider: activeSessionProvider,
      supportsUiPlugins: activeSessionProvider ? HARNESS_CAPABILITIES[activeSessionProvider].supportsUiPlugins : false,
      hasFolder: Boolean(currentFolder),
      extra: { t, hasSwarm },
    }),
    [activeSessionId, currentFolder, activeSessionProvider, t, hasSwarm],
  )
  const subscribeLauncherMenu = useCallback(
    (onStoreChange: () => void) => kernel.menus.subscribeMenu('activity.launcher', onStoreChange),
    [kernel],
  )
  const menuVersion = useSyncExternalStore(
    subscribeLauncherMenu,
    () => kernel.menus.getVersion('activity.launcher'),
    () => -1,
  )
  const contributedItems = useMemo(() => {
    void menuVersion
    return kernel.menus.getMenuItems('activity.launcher', launcherMenuCtx)
  }, [kernel, launcherMenuCtx, menuVersion])

  const orderedEntries: Array<{ order: number; item: ActivityLaunchType }> = [
    {
      order: 10,
      item: {
        id: 'browser',
        icon: Globe,
        label: t('activity.launcher.browser'),
        shortcut: isMac ? '⌘T' : 'Ctrl+T',
        onOpen: () => openBrowserTab(),
      },
    },
    {
      order: 20,
      item: {
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
    },
    ...(activeSessionId
      ? [{
          order: 40,
          item: {
            id: 'device',
            icon: Smartphone,
            label: t('activity.launcher.device'),
            onOpen: () => { openDeviceTab(activeSessionId, t('activity.device.title')) },
          },
        }]
      : []),
    ...contributedItems.map((entry) => ({
      order: entry.order,
      item: {
        id: entry.id,
        icon: entry.icon ?? Puzzle,
        label: entry.label,
        shortcut: entry.shortcut,
        disabled: entry.disabled,
        onOpen: entry.onSelect,
      },
    })),
  ]

  orderedEntries.sort((a, b) => a.order - b.order)

  return orderedEntries.map(({ item }) => ({
    ...item,
    onOpen: () => { item.onOpen(); focusActivePanelContent() },
  }))
}
