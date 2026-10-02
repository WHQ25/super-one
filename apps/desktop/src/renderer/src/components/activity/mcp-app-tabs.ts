import type { DockviewApi, IDockviewPanel } from 'dockview-core'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { parkMcpAppFullscreenFrames, resumeMcpAppFullscreenFrames, useMcpAppLayout, type McpAppSurface } from '@/components/mcp-apps/layout-store'

const panelId = (key: string) => `mcp-app:${key}`
type Previous = { showPanel: boolean; maximizedGroupId: string | null; activePanelId?: string }
const tabs = new Map<string, { previous: Previous; opening: boolean }>()
let dock: DockviewApi | null = null
let maximize: ((panelId: string) => void) | undefined
let dispose: (() => void) | undefined

/** Bracket Dockview's DOM mutations, including its own tab close and Shrink. */
export function connectMcpAppTabs(api: DockviewApi | null, maximizePanel?: (panelId: string) => void): void {
  dispose?.(); dispose = undefined
  if (dock !== api) closeMcpAppTabs()
  dock = api; maximize = maximizePanel
  if (!api) return
  const before = api.onWillMutateLayout(() => parkMcpAppFullscreenFrames())
  const after = api.onDidMutateLayout(() => {
    // React may attach the new panel after Dockview finishes the mutation.
    // Its surface ref also resumes the parked frame when it becomes connected.
    resumeMcpAppFullscreenFrames()
    queueMicrotask(() => {
      if (dock !== api) return
      for (const [key, tab] of tabs) {
        if (tab.opening) continue
        // Shrinking keeps the View in its tab; only closing the tab returns it to the chat.
        if (!api.getPanel(panelId(key))) useMcpAppLayout.getState().setMode(key, 'inline')
      }
    })
  })
  dispose = () => { before.dispose(); after.dispose() }
  for (const [key, owner] of Object.entries(useMcpAppLayout.getState().views)) if (owner.mode === 'fullscreen') syncMcpAppTab(key, 'fullscreen')
}

/** A fullscreen View is a real activity tab, maximized on request and toggled from its tab. */
export function syncMcpAppTab(key: string, mode: McpAppSurface, maximized = true): void {
  if (mode !== 'fullscreen') {
    const tab = tabs.get(key)
    if (!tab) return
    tabs.delete(key) // Closing mutates Dockview synchronously; do not re-enter.
    const panel = dock?.getPanel(panelId(key))
    panel?.api.close()
    const previousPanel = tab.previous.activePanelId ? dock?.getPanel(tab.previous.activePanelId) : undefined
    previousPanel?.api.setActive()
    const previousGroup = dock?.groups.find(group => group.id === tab.previous.maximizedGroupId)
    if (previousGroup?.panels[0]) previousGroup.panels[0].api.maximize()
    else if (dock?.hasMaximizedGroup()) dock.exitMaximizedGroup()
    const store = useActivityPanelStore.getState()
    store.setShowPanel(tab.previous.showPanel)
    store.setMaximizedGroup(previousGroup?.id ?? null)
    return
  }
  const owner = useMcpAppLayout.getState().views[key]
  if (!dock || !owner) return
  const store = useActivityPanelStore.getState()
  if (tabs.has(key)) {
    const panel = dock.getPanel(panelId(key))
    panel?.api.setActive()
    if (maximized && panel && !panel.api.isMaximized()) maximizePanel(panel)
    return
  }
  const tab = { previous: { showPanel: store.showPanel, maximizedGroupId: store.maximizedGroupId, activePanelId: dock.activePanel?.id }, opening: true }
  tabs.set(key, tab)
  try {
    store.setShowPanel(true, { forTab: true })
    const group = dock.groups.find(group => group.id === store.maximizedGroupId)
    const panel = dock.addPanel({ id: panelId(key), component: 'mcp-app', tabComponent: 'mcp-app-tab', title: owner.app.binding.server,
      params: { appInstanceId: key }, renderer: 'always',
      ...(group ? { position: { referenceGroup: group, direction: 'within' as const } } : {}),
    })
    if (maximized && !panel.api.isMaximized()) maximizePanel(panel)
  } finally { tab.opening = false }
}

function maximizePanel(panel: IDockviewPanel): void {
  if (maximize) maximize(panel.id)
  else { panel.api.maximize(); useActivityPanelStore.getState().setMaximizedGroup(panel.group.id) }
}

/** Fullscreen tabs are transient and never enter a parked session snapshot. */
export function closeMcpAppTabs(): void {
  for (const key of [...tabs.keys()]) useMcpAppLayout.getState().setMode(key, 'inline')
}
