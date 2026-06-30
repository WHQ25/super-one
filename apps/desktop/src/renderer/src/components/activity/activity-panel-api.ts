import type { DockviewApi, AddPanelPositionOptions, SerializedDockview } from 'dockview-core'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAppStore } from '@/stores/app'
import { useBrowserStore } from '@/stores/browser'
import { normalizeUrl } from '@/components/browser/browser-url'
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

export function openBrowserTab(url = 'about:blank', reuseId?: string) {
  const app = useAppStore.getState()
  if (app.layoutMode !== 'coding' && app.currentFolder) app.setLayoutMode('coding')
  ensureVisible()
  execOrDefer(() => {
    if (!dockApi) return
    const browserId = reuseId ?? `browser-${crypto.randomUUID()}`
    useBrowserStore.getState().ensure(browserId, normalizeUrl(url))
    const existing = dockApi.panels.find((p) => p.id === browserId)
    if (existing) {
      existing.api.setActive()
      return
    }
    dockApi.addPanel({
      id: browserId,
      component: 'browser',
      tabComponent: 'browser-tab',
      title: 'New Tab',
      params: { browserId, url },
    })
  })
}

export function closeBrowserTab(browserId: string) {
  const existing = dockApi?.panels.find((p) => p.id === browserId)
  existing?.api.close()
  useBrowserStore.getState().remove(browserId)
}

export function maximizeBrowserTab(browserId: string) {
  useBrowserStore.getState().setFullscreen(browserId)
  dockApi?.panels.find((p) => p.id === browserId)?.api.close()
  useAppStore.getState().setLayoutMode('canvas')
}

export function restoreBrowserToPanel() {
  const store = useBrowserStore.getState()
  const id = store.fullscreenId
  store.setFullscreen(null)
  if (id) openBrowserTab(store.tabs[id]?.url ?? 'about:blank', id)
  else useAppStore.getState().setLayoutMode('coding')
}

export function closeFullscreenBrowser() {
  const store = useBrowserStore.getState()
  const id = store.fullscreenId
  store.setFullscreen(null)
  if (id) store.remove(id)
  useAppStore.getState().setLayoutMode('coding')
}
