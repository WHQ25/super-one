import type { DockviewApi, AddPanelPositionOptions, SerializedDockview } from 'dockview-core'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { normalizeFileLinkTarget } from '@/lib/file-link'

let dockApi: DockviewApi | null = null
let pendingAction: (() => void) | null = null
let onDockReadyCb: (() => void) | null = null

export function setDockApi(api: DockviewApi | null) {
  dockApi = api
  if (api && pendingAction) {
    const action = pendingAction
    pendingAction = null
    action()
  }
  if (api) onDockReadyCb?.()
}

export function getDockApi() {
  return dockApi
}

export function setOnDockReady(cb: (() => void) | null) {
  onDockReadyCb = cb
}

export function getDockSnapshot(): SerializedDockview | null {
  return dockApi?.toJSON() ?? null
}

export function applyDockSnapshot(json: SerializedDockview | null): boolean {
  if (!dockApi) return false
  if (json) dockApi.fromJSON(json)
  else dockApi.clear()
  return true
}

export function isDockReady(): boolean {
  return dockApi !== null
}

export function closeGhostMiniAppPanels(isAlive: (instanceKey: string) => boolean): void {
  if (!dockApi) return
  for (const panel of [...dockApi.panels]) {
    if (!panel.id.startsWith('miniapp-')) continue
    const instanceKey = panel.id.slice('miniapp-'.length)
    if (!isAlive(instanceKey)) panel.api.close()
  }
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
  const normalizedPath = normalizeFileLinkTarget(filePath)
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath
  dockApi.addPanel({
    id: `file:${normalizedPath}`,
    component: 'file-preview',
    tabComponent: 'file-preview-tab',
    title: fileName,
    params: { filePath: normalizedPath },
    ...(position ? { position } : {}),
  })
}

export function openFileTab(filePath: string) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const normalizedPath = normalizeFileLinkTarget(filePath)
    const panelId = `file:${normalizedPath}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    const activePanel = dockApi.activePanel
    if (activePanel?.id.startsWith('file:')) {
      const group = activePanel.group
      addFilePanel(normalizedPath, group ? { referenceGroup: group, direction: 'within' } : undefined)
      activePanel.api.close()
      return
    }
    addFilePanel(normalizedPath)
  })
}

export function openNewFileTab(filePath: string, options?: { direction?: 'within' | 'right' | 'below' | 'above' | 'left'; referencePanel?: string }) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const normalizedPath = normalizeFileLinkTarget(filePath)
    const panelId = `file:${normalizedPath}`
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
    addFilePanel(normalizedPath, position)
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

export function openMiniAppTab(instanceKey: string, appId: string, label: string) {
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const panelId = `miniapp-${instanceKey}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    dockApi.addPanel({
      id: panelId,
      component: 'miniapp',
      tabComponent: 'miniapp-tab',
      title: label,
      params: { instanceKey, appId },
    })
  })
}

export function closeMiniAppTab(instanceKey: string) {
  if (!dockApi) return
  const panelId = `miniapp-${instanceKey}`
  const existing = dockApi.panels.find((p) => p.id === panelId)
  if (existing) existing.api.close()
}
