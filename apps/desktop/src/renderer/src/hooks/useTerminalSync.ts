import { useEffect } from 'react'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useTerminalStore } from '@/stores/terminal'
import { useTerminalPanel } from './useTerminalPanel'
import { dropActivityTerminalTab, revealTerminalTabInActivity } from '@/components/activity/activity-panel-api'

export function tabBelongsToProject(item: Pick<TerminalListItem, 'cwd' | 'projectPath'>, projectPath: string): boolean {
  if (item.projectPath === projectPath) return true
  if (item.cwd === projectPath) return true
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  return item.cwd.startsWith(root)
}

/**
 * Whether the bottom terminal panel lists this tab. The panel is per project,
 * so an agent-opened tab — owned by one session and docked in that session's
 * activity panel — stays out, or every session in the project would see it.
 * A tab the user opened from the activity launcher already has its dock tab.
 */
export function tabShowsInTerminalPanel(item: Pick<TerminalListItem, 'cwd' | 'projectPath' | 'agentSessionId' | 'openedInActivity'>, projectPath: string): boolean {
  return !item.agentSessionId && !item.openedInActivity && tabBelongsToProject(item, projectPath)
}

/**
 * Keep the desktop tab strip in sync with PTYs created or killed on a phone,
 * and surface the panel when a phone takes a tab — the same observation
 * model as a remote-locked session.
 */
export function useTerminalSync(): void {
  const { setOpen } = useTerminalPanel()
  const upsertTab = useTerminalStore((s) => s.upsertTab)
  const removeTab = useTerminalStore((s) => s.removeTab)
  const renameTab = useTerminalStore((s) => s.renameTab)
  const setTabOwner = useTerminalStore((s) => s.setTabOwner)
  const setTabControl = useTerminalStore((s) => s.setTabControl)
  const setActive = useTerminalStore((s) => s.setActive)

  useEffect(() => {
    const off = window.terminal.onTerminalEvent((event: TerminalEvent) => {
      const folder = useAppStore.getState().currentFolder
      if (event.type === 'terminal_created') {
        if (!folder || !tabBelongsToProject(event.item, folder)) return
        // An agent-opened tab is the agent's screen: dock it next to the agent's
        // browser tabs so the user can find it and take over, without opening the
        // panel — like browser automation, the agent's work runs in the background.
        // The reveal is owner-aware, so a tab for a session the user is not viewing
        // waits in main until that session is restored.
        if (event.item.agentSessionId) revealTerminalTabInActivity(event.item, { reveal: false })
        else if (tabShowsInTerminalPanel(event.item, folder)) upsertTab(folder, event.item)
        return
      }
      if (!event.terminalId) return
      if (event.type === 'terminal_control_changed') setTabControl(event.terminalId, event.control)
      if (event.type === 'terminal_title_changed') renameTab(event.terminalId, event.title)
      if (event.type === 'terminal_owner_changed') {
        setTabOwner(event.terminalId, event.ownerDeviceId)
        if (event.ownerDeviceId && folder) revealRemoteTab(folder, event.terminalId, event.ownerDeviceId, upsertTab, setActive, setOpen)
      }
      if (event.type === 'terminal_exited') {
        dropActivityTerminalTab(event.terminalId)
        for (const [path, pt] of Object.entries(useTerminalStore.getState().byProject)) {
          if (pt.tabs.some((tab) => tab.terminalId === event.terminalId)) removeTab(path, event.terminalId)
        }
      }
    })
    return off
  }, [upsertTab, removeTab, renameTab, setTabOwner, setTabControl, setActive, setOpen])
}

function revealRemoteTab(
  folder: string,
  terminalId: string,
  ownerDeviceId: string,
  upsertTab: (projectPath: string, item: TerminalListItem) => void,
  setActive: (projectPath: string, terminalId: string) => void,
  setOpen: (open: boolean) => void,
): void {
  const existing = useTerminalStore.getState().byProject[folder]?.tabs.find((tab) => tab.terminalId === terminalId)
  if (existing) {
    setActive(folder, terminalId)
    setOpen(true)
    return
  }
  void window.terminal.list().then((items) => {
    const item = items.find((row) => row.terminalId === terminalId)
    if (!item || !tabBelongsToProject(item, folder)) return
    upsertTab(folder, { ...item, ownerDeviceId })
    setActive(folder, terminalId)
    setOpen(true)
  })
}
