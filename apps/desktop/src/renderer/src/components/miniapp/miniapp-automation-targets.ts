import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { toolUiPreviewKey, toolUiPreviewSlotKey, useToolUiPreviewStore, type ToolUiPreview } from '@/stores/miniapp-tool-preview'
import { isMiniAppPipHidden, useMiniAppPipStore } from '@/stores/miniapp-pip'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { dockSessionId, openMiniAppTab, openToolUiPreviewTab } from '@/components/activity/activity-panel-api'
import { clearBrowserConsole, pushBrowserConsole, registerBrowserWebview } from '@/components/browser/browser-host-api'
import { MINIAPP_TARGET_PREFIX, type MiniAppTargetKind } from '@superone/shared/miniapp-automation-target'
import { isDevAppEntry, type MiniAppHostLogEvent } from '@superone/shared/miniapp-types'
import type { OpenAppEntry } from '@/stores/miniapp'

/**
 * Development mini-app WebViews that `browser_*` tools can drive.
 *
 * Each view joins the browser WebView registry under a project-qualified key, so
 * every browser op (scripts, capture, CDP by webContentsId) works on it unchanged.
 * The agent addresses it by the project-free `miniapp:` id; the calling session's
 * project picks the instance, which is also the ownership rule.
 */

export interface MiniAppTargetRegistration {
  targetId: string
  appId: string
  projectDir: string
  kind: MiniAppTargetKind
  title: string
}

interface MiniAppTargetRecord extends MiniAppTargetRegistration {
  key: string
  element: Electron.WebviewTag
  ready: boolean
}

export interface MiniAppTargetHandle {
  key: string
  setReady: (ready: boolean) => void
  dispose: () => void
}

const targets = new Map<string, MiniAppTargetRecord>()

const READY_TIMEOUT_MS = 8_000

export function miniAppTargetKey(targetId: string, projectDir: string): string {
  return `${targetId}@${projectDir}`
}

/**
 * The MiniApp Host's output for one app. Failures get their own buffer so routine
 * stdout cannot push them out of the capped console.
 */
export function miniAppHostConsoleKeys(appId: string, projectDir: string): { errors: string; output: string } {
  return { errors: `miniapp-host:${appId}@${projectDir}`, output: `miniapp-host-out:${appId}@${projectDir}` }
}

export function registerMiniAppTarget(registration: MiniAppTargetRegistration, element: Electron.WebviewTag): MiniAppTargetHandle {
  const key = miniAppTargetKey(registration.targetId, registration.projectDir)
  const record: MiniAppTargetRecord = { ...registration, key, element, ready: false }
  targets.set(key, record)
  const unregisterWebview = registerBrowserWebview(key, element)
  return {
    key,
    setReady: (ready) => { record.ready = ready },
    dispose: () => {
      unregisterWebview()
      if (targets.get(key) !== record) return
      targets.delete(key)
      clearBrowserConsole(key)
      // A new guest starts without the CDP emulation, so the resize must not outlive it.
      useBrowserStore.getState().setEmulation(key, null)
    },
  }
}

/**
 * The view is about to be replaced (a new preview fixture remounts it); keep a
 * wait from passing on the outgoing document before React swaps it.
 */
export function markMiniAppTargetStale(targetId: string, projectDir: string): void {
  const record = targets.get(miniAppTargetKey(targetId, projectDir))
  if (record) record.ready = false
}

export function pushMiniAppHostLog(entry: MiniAppHostLogEvent): void {
  const keys = miniAppHostConsoleKeys(entry.appId, entry.projectDir)
  if (entry.reset) {
    clearBrowserConsole(keys.errors)
    clearBrowserConsole(keys.output)
  }
  pushBrowserConsole(entry.level === 'error' ? keys.errors : keys.output, entry.level, `[host] ${entry.text}`)
}

/** Buffer every development Host's output; mounted once with the automation host. */
export function subscribeMiniAppHostLogs(): () => void {
  return window.miniapp.onHostLog(pushMiniAppHostLog)
}

export function projectDirOfSession(
  projectSessions: Record<string, { _sessions: Record<string, unknown> }>,
  sessionId: string,
): string | null {
  for (const [projectDir, project] of Object.entries(projectSessions)) {
    if (project._sessions[sessionId]) return projectDir
  }
  return null
}

export function sessionProjectDir(sessionId: string): string | null {
  return projectDirOfSession(useChatStore.getState().projectSessions, sessionId)
}

export function requireProjectDir(sessionId: string): string {
  const projectDir = sessionProjectDir(sessionId)
  if (!projectDir) throw new Error('Mini-app views are project-scoped and this session has no project.')
  return projectDir
}

/**
 * Whether the dock shows this session's layout. Another session's layout is the
 * user's workspace: a background agent may use views already on screen there,
 * but must not open or switch its tabs.
 */
export function isSessionDockOnScreen(sessionId: string): boolean {
  const current = dockSessionId()
  return current === null || current === sessionId
}

export function parseMiniAppTargetId(targetId: string): { appId: string; kind: MiniAppTargetKind } {
  const [appId, kind] = targetId.slice(MINIAPP_TARGET_PREFIX.length).split(':')
  if (!appId) throw new Error(`Invalid mini-app view id: ${targetId}`)
  if (kind === 'preview') return { appId, kind: 'preview' }
  if (kind === 'tool') return { appId, kind: 'tool' }
  if (kind === undefined) return { appId, kind: 'panel' }
  throw new Error(`Invalid mini-app view id: ${targetId}`)
}

function devAppEntry(appId: string) {
  const entry = useMiniAppStore.getState().apps.find((app) => app.id === appId)
  if (!entry) throw new Error(`Mini-app ${appId} is not available in the current project.`)
  if (!isDevAppEntry(entry)) throw new Error(`Mini-app ${appId} is installed, not a development app; browser tools only drive development mini-apps.`)
  return entry
}

function openInstanceOf(openApps: Record<string, OpenAppEntry>, appId: string, projectDir: string): OpenAppEntry | undefined {
  return Object.values(openApps).find((app) => app.entry.id === appId && app.projectDir === projectDir)
}

function previewLabel(preview: ToolUiPreview): string {
  return `${preview.appName} · ${preview.toolLabel}`
}

/**
 * The host-layer slot that draws a panel or preview view; null for a chat tool UI,
 * which lives in the transcript, or for a view that is not open.
 */
export function miniAppHostSlotKey(
  targetId: string,
  projectDir: string,
  openApps: Record<string, OpenAppEntry>,
  previews: Record<string, ToolUiPreview>,
): string | null {
  const { appId, kind } = parseMiniAppTargetId(targetId)
  if (kind === 'panel') return openInstanceOf(openApps, appId, projectDir)?.instanceKey ?? null
  if (kind === 'preview') {
    const key = toolUiPreviewKey(appId, projectDir)
    return previews[key] ? toolUiPreviewSlotKey(key) : null
  }
  return null
}

/** Open or activate the view's dock tab; `reveal: false` leaves the Activity panel closed. */
async function openTargetTab(targetId: string, projectDir: string, reveal: boolean): Promise<void> {
  const { appId, kind } = parseMiniAppTargetId(targetId)
  if (kind === 'preview') {
    const preview = useToolUiPreviewStore.getState().previews[toolUiPreviewKey(appId, projectDir)]
    if (!preview) throw new Error(`No tool UI preview is open for ${appId}. Call miniapp_dev_preview first.`)
    openToolUiPreviewTab(preview.key, previewLabel(preview), { reveal })
    return
  }
  const entry = devAppEntry(appId)
  const store = useMiniAppStore.getState()
  const open = openInstanceOf(store.openApps, appId, projectDir)
  if (open) openMiniAppTab(open.instanceKey, appId, entry.manifest.name, { reveal })
  else await store.openAppInPanel(entry, projectDir, { reveal })
}

/** Move a view from picture-in-picture into the Activity panel. */
export function showMiniAppTargetInPanel(targetId: string, projectDir: string): void {
  void openTargetTab(targetId, projectDir, true)
}

/**
 * Drawn where the user can see it. Host-layer views park at -99999 and dock
 * content keeps its box while the panel is closed, so size alone says nothing.
 */
function onScreen(record: MiniAppTargetRecord | undefined): boolean {
  if (!record?.element.isConnected) return false
  const rect = record.element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
    && rect.right > 0 && rect.bottom > 0
    && rect.left < window.innerWidth && rect.top < window.innerHeight
}

/**
 * With the Activity panel closed, a driven view is presented in picture-in-
 * picture, as a browser tab is; mosaic and a folded window have neither.
 */
function presentsInPip(): boolean {
  return !useActivityPanelStore.getState().showPanel && useMosaicStore.getState().mode === 'single'
}

/** Bring the view on screen: layout, hit-testing, and pixels only exist there. */
async function revealTarget(targetId: string, sessionId: string, projectDir: string, record: MiniAppTargetRecord | undefined): Promise<void> {
  const { kind } = parseMiniAppTargetId(targetId)
  if (kind === 'tool') {
    if (!record) throw new Error(`Tool UI ${targetId} is not mounted. Expand it in the chat, or render it with miniapp_dev_preview.`)
    record.element.scrollIntoView({ block: 'nearest' })
    return
  }
  // The picture-in-picture shows the target the session's viewfinder names.
  useAgentViewfinderStore.getState().activate(sessionId, 'miniapp', targetId)
  // Re-activating a dock tab steals the user's focus; a view already on screen stays put.
  if (onScreen(record)) return
  if (!isSessionDockOnScreen(sessionId)) {
    throw new Error(`${targetId} is not on screen and this session runs in the background; its tabs cannot be opened in the workspace the user is viewing. Ask the user to switch to this session.`)
  }
  const pip = presentsInPip()
  if (pip && isMiniAppPipHidden(useMiniAppPipStore.getState(), sessionId, targetId)) {
    throw new Error(`The user hid the picture-in-picture of ${targetId}. Ask the user to show it again from the chat status bar or to open the Activity panel.`)
  }
  await openTargetTab(targetId, projectDir, !pip)
}

/**
 * The guest behind a moved or re-inserted WebView is rebuilt before any load
 * event reports it, and every guest method throws until then.
 */
function guestUsable(element: Electron.WebviewTag): boolean {
  try {
    element.getWebContentsId()
    return true
  } catch {
    return false
  }
}

/** A chat tool UI only needs a layout; a panel or preview must be on screen. */
function shownFor(record: MiniAppTargetRecord): boolean {
  return record.kind === 'tool' ? record.element.offsetWidth > 0 : onScreen(record)
}

/**
 * `laidOut` also waits for the reveal to take effect: a view that is still
 * display:none reports zero-size boxes to every script and cannot be captured.
 */
async function waitForReady(key: string, signal: AbortSignal | undefined, laidOut: boolean): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() <= deadline) {
    signal?.throwIfAborted()
    const record = targets.get(key)
    if (record?.ready && record.element.isConnected && guestUsable(record.element) && (!laidOut || shownFor(record))) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const record = targets.get(key)
  if (record?.ready && record.element.isConnected && guestUsable(record.element)) {
    throw new Error('Mini-app view is loaded but not visible: SuperOne could not show its panel (the workspace UI may not be open). Ask the user to open it; do not retry.')
  }
  throw new Error(record ? 'Mini-app view did not finish loading in time' : 'Mini-app view did not mount in time')
}

/**
 * Resolve an agent-facing `miniapp:` id to its registry key, revealing the view
 * and waiting until its document is ready.
 */
export async function resolveMiniAppTarget(targetId: string, sessionId: string, signal?: AbortSignal): Promise<string> {
  const projectDir = requireProjectDir(sessionId)
  const key = miniAppTargetKey(targetId, projectDir)
  await revealTarget(targetId, sessionId, projectDir, targets.get(key))
  await waitForReady(key, signal, true)
  return key
}

/**
 * Only the guest's webContentsId, for driver bookkeeping and CDP domains that
 * need no layout: no reveal, so an action does not reveal its view twice.
 */
export async function miniAppTargetWebContentsId(targetId: string, sessionId: string, signal?: AbortSignal): Promise<number> {
  const key = miniAppTargetKey(targetId, requireProjectDir(sessionId))
  if (!targets.has(key)) parseMiniAppTargetId(targetId)
  await waitForReady(key, signal, false)
  return targets.get(key)!.element.getWebContentsId()
}

export function listMiniAppTargets(sessionId: string): Array<{ tab: string; url: string; title: string; loading: boolean }> {
  const projectDir = sessionProjectDir(sessionId)
  if (!projectDir) return []
  return [...targets.values()]
    .filter((record) => record.projectDir === projectDir)
    .map((record) => ({
      tab: record.targetId,
      // The query string of a tool UI carries its whole payload.
      url: record.element.getAttribute('src')?.split('?')[0] ?? '',
      title: record.title,
      loading: !record.ready,
    }))
}

/** The view's own console plus its app's Host output, for `browser_snapshot`. */
export function miniAppConsoleKeys(key: string): string[] {
  const record = targets.get(key)
  if (!record) return [key]
  const host = miniAppHostConsoleKeys(record.appId, record.projectDir)
  return [key, host.errors, host.output]
}

async function reloadRecord(record: MiniAppTargetRecord, signal: AbortSignal | undefined): Promise<void> {
  // Cleared before reload() so a wait cannot pass on the outgoing document.
  record.ready = false
  record.element.reload()
  await waitForReady(record.key, signal, false)
}

export async function reloadMiniAppView(key: string, signal?: AbortSignal): Promise<void> {
  const record = targets.get(key)
  if (!record) throw new Error('Mini-app view is not mounted')
  await reloadRecord(record, signal)
}

/**
 * Reload every mounted view of one app in the session's project. Views are
 * independent: one that is slow or detached is reported, not fatal, since the
 * Host has already been replaced by the time this runs.
 */
export async function reloadMiniAppTargets(appId: string, sessionId: string, signal?: AbortSignal): Promise<{
  reloadedViews: number
  notReloaded?: Array<{ tab: string; error: string }>
}> {
  const projectDir = requireProjectDir(sessionId)
  const records = [...targets.values()].filter((record) => record.appId === appId && record.projectDir === projectDir)
  const notReloaded: Array<{ tab: string; error: string }> = []
  let reloadedViews = 0
  const results = await Promise.allSettled(records.map((record) => {
    // A detached view (hidden dock tab) loads the new code when it is shown.
    if (!record.element.isConnected) return Promise.reject(new Error('not on screen; it loads the new code when shown'))
    return reloadRecord(record, signal)
  }))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') reloadedViews += 1
    else notReloaded.push({ tab: records[index].targetId, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })
  return notReloaded.length ? { reloadedViews, notReloaded } : { reloadedViews }
}
