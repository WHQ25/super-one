import type { DockviewApi, AddPanelPositionOptions, IDockviewPanel, SerializedDockview } from 'dockview-core'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'
import { useDeviceInstanceStore } from '@/stores/device-instances'
import { isBlankUrl, normalizeUrl } from '@/components/browser/browser-url'
import { normalizeFileLinkTarget } from '@/lib/file-link'
import { disposeActivityTermInstance } from './activity-terminal'

let dockApi: DockviewApi | null = null
let pendingAction: (() => void) | null = null
let onDockReadyCb: (() => void) | null = null
let currentSessionIdGetter: (() => string | null) | null = null

// Panels opened while mosaic (chat-only) owns the layout live in the hidden dock,
// but exiting mosaic restores each tile's parked snapshot and clobbers them. While
// recording is on (App toggles it on mosaic entry) we remember the opens and replay
// them after the exit-restore so they survive the return to single and show. A
// getter-injection-free boolean keeps this module clear of store import cycles.
let mosaicOpenedPanels: { id: string; replay: () => void }[] = []
let mosaicRecording = false

export function beginMosaicRecording() {
  mosaicRecording = true
  mosaicOpenedPanels = []
}

function recordMosaicOpen(id: string, replay: () => void) {
  if (!mosaicRecording) return
  if (mosaicOpenedPanels.some((p) => p.id === id)) return
  mosaicOpenedPanels.push({ id, replay })
}

function removeMosaicOpen(id: string) {
  if (!mosaicOpenedPanels.length) return
  mosaicOpenedPanels = mosaicOpenedPanels.filter((p) => p.id !== id)
}

export function replayMosaicOpenedPanels() {
  mosaicRecording = false
  const panels = mosaicOpenedPanels
  mosaicOpenedPanels = []
  for (const p of panels) p.replay()
}

export function setCurrentSessionIdGetter(getter: (() => string | null) | null) {
  currentSessionIdGetter = getter
}

export function setDockApi(api: DockviewApi | null) {
  dockApi = api
  if (!api) useActivityPanelStore.getState().setMaximizedGroup(null)
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
  useActivityPanelStore.getState().setMaximizedGroup(null)
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

/**
 * Move DOM focus onto the active panel's content.
 *
 * Dockview activates a panel without touching focus — its `panel.focus()` only
 * flips the active flag — so a tab opened from the keyboard leaves focus wherever
 * it was, which after the first ⌘T is nowhere. Panel-scoped shortcuts are gated on
 * the activity panel owning focus (see activity-focus.ts), so the second ⌘T in a
 * row did nothing until the user clicked. The group's content container is
 * dockview's own focus target (tabIndex -1); whatever the panel renders can still
 * claim focus off it once mounted, as the terminal does.
 */
export function focusActivePanelContent(): void {
  const container = dockApi?.activeGroup?.element.querySelector<HTMLElement>('.dv-content-container')
  container?.focus({ preventScroll: true })
}

/**
 * Browser tabs the user just opened blank and in the foreground, waiting for their
 * omnibox to mount and claim focus — the Chrome behaviour where ⌘T lands the caret
 * in the address bar so a URL can be typed straight away.
 *
 * A handoff rather than a direct focus call because the panel's React content only
 * mounts after `addPanel` returns, so there is no input to focus yet. Blank tabs
 * only: opening a link in a new tab means the page is the thing you came for.
 */
const pendingOmniboxFocus = new Set<string>()

/** Consume the pending focus for this tab, if any. Single-shot. */
export function claimNewTabOmniboxFocus(browserId: string): boolean {
  return pendingOmniboxFocus.delete(browserId)
}

function getMaximizedGroup() {
  const groupId = useActivityPanelStore.getState().maximizedGroupId
  return groupId ? dockApi?.groups.find((group) => group.id === groupId) : undefined
}

function positionInMaximizedGroup(fallback?: AddPanelPositionOptions): AddPanelPositionOptions | undefined {
  const group = getMaximizedGroup()
  return group ? { referenceGroup: group, direction: 'within' } : fallback
}

function activateInMaximizedGroup(panel: IDockviewPanel, inactive = false) {
  const group = getMaximizedGroup()
  if (group && panel.group.id !== group.id) {
    panel.api.moveTo({ group, index: group.panels.length, skipSetActive: inactive })
  }
  if (!inactive) panel.api.setActive()
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
      activateInMaximizedGroup(existing)
      return
    }
    const activePanel = dockApi.activePanel
    if (activePanel?.id.startsWith('file:')) {
      const group = activePanel.group
      addFilePanel(normalizedPath, positionInMaximizedGroup(group ? { referenceGroup: group, direction: 'within' } : undefined))
      activePanel.api.close()
      return
    }
    addFilePanel(normalizedPath, positionInMaximizedGroup())
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
      activateInMaximizedGroup(existing)
      return
    }
    const position = options?.referencePanel
      ? { referencePanel: options.referencePanel, direction: options.direction ?? 'within' }
      : options?.direction && options.direction !== 'within'
        ? { direction: options.direction }
        : undefined
    addFilePanel(normalizedPath, positionInMaximizedGroup(position))
  })
}

export function openMiniAppTab(instanceKey: string, appId: string, label: string) {
  ensureVisible()
  recordMosaicOpen(`miniapp-${instanceKey}`, () => openMiniAppTab(instanceKey, appId, label))
  execOrDefer(() => {
    if (!dockApi) return
    const panelId = `miniapp-${instanceKey}`
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      activateInMaximizedGroup(existing)
      return
    }
    const position = positionInMaximizedGroup()
    dockApi.addPanel({
      id: panelId,
      component: 'miniapp',
      tabComponent: 'miniapp-tab',
      title: label,
      params: { instanceKey, appId },
      ...(position ? { position } : {}),
    })
  })
}

/**
 * Open (or reveal) the Trajectory ledger for one dsh session.
 *
 * Keyed by session so a second open reveals the existing panel: the ledger is
 * a view of that session's log, and two of them would only compete to refresh.
 */
export function openTrajectoryTab(sessionId: string, label: string) {
  ensureVisible()
  const panelId = `trajectory-${sessionId}`
  recordMosaicOpen(panelId, () => openTrajectoryTab(sessionId, label))
  execOrDefer(() => {
    if (!dockApi) return
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      activateInMaximizedGroup(existing)
      return
    }
    const position = positionInMaximizedGroup()
    dockApi.addPanel({
      id: panelId,
      component: 'trajectory',
      tabComponent: 'trajectory-tab',
      title: label,
      params: { sessionId },
      ...(position ? { position } : {}),
    })
  })
}

export function closeTrajectoryTab(sessionId: string) {
  const panelId = `trajectory-${sessionId}`
  removeMosaicOpen(panelId)
  dockApi?.panels.find((p) => p.id === panelId)?.api.close()
}

/**
 * A place to watch a device from. Every call opens a NEW one unless handed an
 * instance that already exists.
 *
 * The instance, not the session, is the tab's identity — which is what lets one chat
 * session hold two devices at once (a client build and a merchant build, side by
 * side) and what lets a tab keep its place in the strip when the user picks a
 * different device inside it. Keyed by session, the second "+ → Device" only
 * re-activated the first tab, and there was no way to open a second device at all.
 */
export function openDeviceTab(sessionId: string, label: string, existingInstanceId?: string) {
  const instanceId = existingInstanceId
    ?? useDeviceInstanceStore.getState().open(sessionId)
  ensureVisible()
  const panelId = `device-${instanceId}`
  recordMosaicOpen(panelId, () => openDeviceTab(sessionId, label, instanceId))
  execOrDefer(() => {
    if (!dockApi) return
    const existing = dockApi.panels.find((panel) => panel.id === panelId)
    if (existing) {
      activateInMaximizedGroup(existing)
      return
    }
    const position = positionInMaximizedGroup()
    dockApi.addPanel({
      id: panelId,
      component: 'device',
      tabComponent: 'device-tab',
      title: label,
      params: { instanceId },
      ...(position ? { position } : {}),
    })
  })
  return instanceId
}

/**
 * Whether this instance already has a tab — NOT whether it is the active one. A
 * device that is somewhere in the tab strip has a home the user can find; a caller
 * that only wants to guarantee the device is reachable must not steal focus from
 * whatever the user actually came to the panel to look at.
 */
export function hasDeviceTab(instanceId: string): boolean {
  return dockApi?.panels.some((panel) => panel.id === `device-${instanceId}`) ?? false
}

export function closeDeviceTab(instanceId: string) {
  const panelId = `device-${instanceId}`
  removeMosaicOpen(panelId)
  dockApi?.panels.find((panel) => panel.id === panelId)?.api.close()
  // Only this tab's device. A second tab in the same session is still watching its
  // own, and releasing by session would take that one down with this one.
  const held = useDeviceInstanceStore.getState().byId[instanceId]?.deviceId
  useDeviceInstanceStore.getState().close(instanceId)
  if (held) void window.environment.deviceRelease(held)
}

export function closeMiniAppTab(instanceKey: string) {
  const panelId = `miniapp-${instanceKey}`
  removeMosaicOpen(panelId)
  if (!dockApi) return
  const existing = dockApi.panels.find((p) => p.id === panelId)
  if (existing) existing.api.close()
}

export function openBrowserTab(url = 'about:blank', reuseId?: string, owner?: string | null, opts?: { background?: boolean; reveal?: boolean }) {
  const resolvedOwner = owner !== undefined ? owner : (currentSessionIdGetter?.() ?? null)
  const browserId = reuseId ?? `browser-${crypto.randomUUID()}`
  // Register the tab (and its persistent webview, rendered per store tab by
  // BrowserHostLayer) up front so background automation can drive it even before
  // its dock panel exists.
  useBrowserStore.getState().ensure(browserId, normalizeUrl(url), resolvedOwner)

  // A tab opened for a session the user isn't currently viewing must NOT land in
  // the live dock — the single dockview reflects the current session, so adding
  // here would surface another session's tab in the wrong activity panel. It is
  // materialized into its owner's layout when that session is next restored.
  const currentSession = currentSessionIdGetter?.() ?? null
  if (resolvedOwner != null && resolvedOwner !== currentSession) return

  if (opts?.reveal !== false) ensureVisible()
  const foreground = !opts?.background && opts?.reveal !== false
  recordMosaicOpen(browserId, () => openBrowserTab(url, browserId, resolvedOwner, opts))
  execOrDefer(() => {
    if (!dockApi) return
    const existing = dockApi.panels.find((p) => p.id === browserId)
    if (existing) {
      activateInMaximizedGroup(existing, opts?.background)
    } else {
      const position = positionInMaximizedGroup()
      dockApi.addPanel({
        id: browserId,
        component: 'browser',
        tabComponent: 'browser-tab',
        title: 'New Tab',
        params: { browserId, url },
        ...(opts?.background ? { inactive: true } : {}),
        ...(position ? { position } : {}),
      })
      if (foreground && isBlankUrl(url)) pendingOmniboxFocus.add(browserId)
    }
    // Foreground opens only: `reveal: false` is the agent's automation path and
    // `background` is Cmd+click, neither of which may take focus off the user.
    if (foreground) focusActivePanelContent()
  })
}

// When a session is restored, add dock panels for any browser tab it owns that a
// background open registered while another session was on screen. Keeps a session's
// agent-opened tabs confined to that session's activity panel.
export function materializeOwnedBrowserTabs(sessionId: string) {
  if (!dockApi) return
  const { tabs } = useBrowserStore.getState()
  for (const [id, tab] of Object.entries(tabs)) {
    if (tab.owner !== sessionId) continue
    if (dockApi.panels.find((p) => p.id === id)) continue
    const position = positionInMaximizedGroup()
    dockApi.addPanel({
      id,
      component: 'browser',
      tabComponent: 'browser-tab',
      title: tab.title || 'New Tab',
      params: { browserId: id, url: tab.url },
      ...(position ? { position } : {}),
    })
  }
}

export async function openTerminalTab(projectPath: string, sessionId?: string) {
  ensureVisible()
  const item = await window.terminal.create({ projectPath, sessionId })
  const panelId = `terminal-${item.terminalId}`
  execOrDefer(() => {
    if (!dockApi) return
    const existing = dockApi.panels.find((p) => p.id === panelId)
    if (existing) {
      activateInMaximizedGroup(existing)
    } else {
      const position = positionInMaximizedGroup()
      dockApi.addPanel({
        id: panelId,
        component: 'terminal',
        tabComponent: 'terminal-tab',
        title: item.title || 'Terminal',
        params: { terminalId: item.terminalId },
        ...(position ? { position } : {}),
      })
    }
  })
}

export function closeActivityTerminalTab(terminalId: string) {
  void window.terminal.kill(terminalId)
  disposeActivityTermInstance(terminalId)
  const existing = dockApi?.panels.find((p) => p.id === `terminal-${terminalId}`)
  existing?.api.close()
}

export function closeBrowserTab(browserId: string) {
  removeMosaicOpen(browserId)
  const existing = dockApi?.panels.find((p) => p.id === browserId)
  existing?.api.close()
  useBrowserStore.getState().remove(browserId)
}

export function maximizeActivityPanel() {
  ensureVisible()
  const panel = dockApi?.activePanel
  if (!panel || panel.api.isMaximized()) return
  panel.api.maximize()
  useActivityPanelStore.getState().setMaximizedGroup(panel.group.id)
}

export function toggleMaximizedActivityGroup(panelId: string) {
  ensureVisible()
  const panel = dockApi?.panels.find((candidate) => candidate.id === panelId)
  if (!panel) return
  if (panel.api.isMaximized()) {
    panel.api.exitMaximized()
    useActivityPanelStore.getState().setMaximizedGroup(null)
  } else {
    panel.api.maximize()
    useActivityPanelStore.getState().setMaximizedGroup(panel.group.id)
  }
}
