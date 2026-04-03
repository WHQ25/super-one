import type { DockviewApi, AddPanelPositionOptions } from 'dockview-core'
import { useActivityPanelStore } from '@/stores/activity-panel'

let dockApi: DockviewApi | null = null
let pendingAction: (() => void) | null = null

export function setDockApi(api: DockviewApi | null) {
  dockApi = api
  if (api && pendingAction) {
    const action = pendingAction
    pendingAction = null
    action()
  }
}

export function getDockApi() {
  return dockApi
}

function ensureVisible() {
  const store = useActivityPanelStore.getState()
  if (!store.showPanel) store.setShowPanel(true)
}

function execOrDefer(fn: () => void) {
  if (dockApi) {
    fn()
  } else {
    pendingAction = fn
  }
}

function addFilePanel(filePath: string, position?: AddPanelPositionOptions) {
  if (!dockApi) return
  const fileName = filePath.split('/').pop() ?? filePath
  dockApi.addPanel({
    id: `file:${filePath}`,
    component: 'file-preview',
    tabComponent: 'file-preview-tab',
    title: fileName,
    params: { filePath },
    ...(position ? { position } : {}),
  })
}

export function openFileTab(filePath: string) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const panelId = `file:${filePath}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    const activePanel = dockApi.activePanel
    if (activePanel?.id.startsWith('file:')) {
      const group = activePanel.group
      addFilePanel(filePath, group ? { referenceGroup: group, direction: 'within' } : undefined)
      activePanel.api.close()
      return
    }
    addFilePanel(filePath)
  })
}

export function openNewFileTab(filePath: string, options?: { direction?: 'within' | 'right' | 'below' | 'above' | 'left'; referencePanel?: string }) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const panelId = `file:${filePath}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    const position = options?.referencePanel
      ? { referencePanel: options.referencePanel, direction: options.direction ?? 'within' }
      : options?.direction && options.direction !== 'within'
        ? { direction: options.direction }
        : undefined
    addFilePanel(filePath, position)
  })
}

export function openHistoryTab() {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const existing = dockApi.panels.find((p) => p.id === 'session-history')
    if (existing) {
      existing.api.setActive()
      return
    }
    dockApi.addPanel({
      id: 'session-history',
      component: 'session-history',
      title: 'History',
    })
  })
}

export function openMiniAppTab(appId: string, label: string) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const panelId = `miniapp-${appId}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    dockApi.addPanel({
      id: panelId,
      component: 'miniapp',
      title: label,
      params: { appId },
    })
  })
}
