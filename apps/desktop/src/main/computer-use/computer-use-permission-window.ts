/**
 * Floating drag chip for Computer Use permissions.
 *
 * Two flows:
 * - guided: first-time enable — Accessibility, then Continue → Screen Recording
 * - single: settings buttons — one pane only
 *
 * Positioning rule: never show the float until macOS System Settings is up and
 * we can place the chip at its left-center.
 */

import { BrowserWindow, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { is } from '@electron-toolkit/utils'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { WindowRole, roleArg } from '../process-titles'
import type { ComputerUsePermissionStatus } from './computer-use-helper-lifecycle'

const execFileAsync = promisify(execFile)

/** Initial shell size — content ResizeObserver reports the true size after layout. */
export const PERMISSION_FLOAT_WIDTH = 300
export const PERMISSION_FLOAT_HEIGHT = 160
const PERMISSION_FLOAT_MIN_WIDTH = 260
const PERMISSION_FLOAT_MAX_WIDTH = 420
const PERMISSION_FLOAT_MIN_HEIGHT = 120
const PERMISSION_FLOAT_MAX_HEIGHT = 360
/** Gap between macOS System Settings left edge and the float (right edge). */
const BESIDE_SYSTEM_SETTINGS_GAP = 16

export type PrivacyPane = 'accessibility' | 'screenRecording'
export type PermissionFloatFlow = 'guided' | 'single'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

let floatWindow: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let doctorPoll: (() => Promise<ComputerUsePermissionStatus>) | null = null
let activeFlow: PermissionFloatFlow | null = null
/** Current target pane for single flow, or active step for guided. */
let activePane: PrivacyPane | null = null
/** Last known macOS System Settings window bounds (for re-anchor after resize). */
let systemSettingsAnchor: Rect | null = null
/** Monotonic id so overlapping open sequences don't show a stale float. */
let showGeneration = 0
/** Remember helper path across guided step transitions. */
let lastHelperPath: string | undefined

const PRIVACY_PANE_URLS: Record<PrivacyPane, string[]> = {
  accessibility: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ],
  screenRecording: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ],
}

export function openComputerUsePrivacyPane(pane: PrivacyPane): void {
  for (const url of PRIVACY_PANE_URLS[pane]) {
    void shell.openExternal(url)
    return
  }
}

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampToWorkArea(
  x: number,
  y: number,
  ww: number,
  wh: number,
  workArea: Rect,
): { x: number; y: number } {
  return {
    x: Math.round(
      Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - ww - 8),
    ),
    y: Math.round(
      Math.min(Math.max(y, workArea.y + 8), workArea.y + workArea.height - wh - 8),
    ),
  }
}

/**
 * Resolve the frontmost System Settings / System Preferences window bounds.
 * Requires Accessibility for SuperOne (System Events).
 */
async function getMacSystemSettingsBounds(): Promise<Rect | null> {
  if (process.platform !== 'darwin') return null
  const script = `
tell application "System Events"
  set candidates to {"System Settings", "System Preferences"}
  repeat with appName in candidates
    if exists process appName then
      tell process appName
        if (count of windows) > 0 then
          set w to window 1
          set p to position of w
          set s to size of w
          return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
        end if
      end tell
    end if
  end repeat
end tell
return ""
`
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 2500,
      maxBuffer: 1024,
    })
    const parts = stdout.trim().split(',').map((s) => Number(s.trim()))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
    const [x, y, width, height] = parts
    if (width < 40 || height < 40) return null
    return { x, y, width, height }
  } catch {
    return null
  }
}

/** Place the float at the vertical center of System Settings, to its left. */
function placeLeftOfSystemSettings(win: BrowserWindow, anchor: Rect): void {
  const [ww, wh] = win.getSize()
  const display = screen.getDisplayMatching({
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  })
  const { workArea } = display
  const x = anchor.x - ww - BESIDE_SYSTEM_SETTINGS_GAP
  const y = anchor.y + (anchor.height - wh) / 2
  const pos = clampToWorkArea(x, y, ww, wh, workArea)
  win.setPosition(pos.x, pos.y)
}

function placeFallback(win: BrowserWindow): void {
  const [ww, wh] = win.getSize()
  const display = screen.getPrimaryDisplay()
  const { workArea } = display
  // Left-center of the primary display as a safe fallback.
  const x = workArea.x + 24
  const y = workArea.y + (workArea.height - wh) / 2
  const pos = clampToWorkArea(x, y, ww, wh, workArea)
  win.setPosition(pos.x, pos.y)
}

/** Poll until System Settings is visible (or time out). */
async function waitForSystemSettingsBounds(maxWaitMs = 4000): Promise<Rect | null> {
  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    const bounds = await getMacSystemSettingsBounds()
    if (bounds) return bounds
    await sleep(150)
  }
  return getMacSystemSettingsBounds()
}

function loadFloat(
  win: BrowserWindow,
  status: ComputerUsePermissionStatus,
  flow: PermissionFloatFlow,
  pane: PrivacyPane,
): void {
  const qs = new URLSearchParams({
    mode: 'computer-use-permissions',
    helperPath: status.helperPath ?? '',
    accessibility: status.accessibility ?? 'missing',
    screenRecording: status.screenRecording ?? 'missing',
    flow,
    pane,
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/?${qs.toString()}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: qs.toString() })
  }
}

function broadcastPermissionStatus(status: Partial<ComputerUsePermissionStatus> & {
  flow?: PermissionFloatFlow | null
  pane?: PrivacyPane | null
}): void {
  const payload = {
    accessibility: status.accessibility,
    screenRecording: status.screenRecording,
    helperPath: status.helperPath,
    screenRecordingNeedsRelaunch: status.screenRecordingNeedsRelaunch,
    flow: status.flow ?? activeFlow,
    pane: status.pane ?? activePane,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(AgentIpcChannels.COMPUTER_USE_PERMISSION_STATUS, payload)
    } catch {
      // window tearing down
    }
  }
}

function waitForContentReady(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve()
  if (!win.webContents.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => resolve()
    win.webContents.once('did-finish-load', done)
    // Safety: don't hang forever if load stalls.
    setTimeout(done, 4000)
  })
}

/**
 * Create the float window already at `anchor` (or fallback), still hidden.
 * Never call show() until the caller is ready.
 */
function createHiddenFloatAt(
  status: ComputerUsePermissionStatus,
  flow: PermissionFloatFlow,
  pane: PrivacyPane,
  anchor: Rect | null,
): BrowserWindow {
  // Tear down any previous instance so we never flash an old on-screen chip.
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
  }
  floatWindow = null

  // Pre-compute screen position so the window is born in the right place
  // (left-center of System Settings).
  const ww = PERMISSION_FLOAT_WIDTH
  const wh = PERMISSION_FLOAT_HEIGHT
  let x: number
  let y: number
  if (anchor) {
    const display = screen.getDisplayMatching(anchor)
    const pos = clampToWorkArea(
      anchor.x - ww - BESIDE_SYSTEM_SETTINGS_GAP,
      anchor.y + (anchor.height - wh) / 2,
      ww,
      wh,
      display.workArea,
    )
    x = pos.x
    y = pos.y
  } else {
    const display = screen.getPrimaryDisplay()
    const pos = clampToWorkArea(
      display.workArea.x + 24,
      display.workArea.y + (display.workArea.height - wh) / 2,
      ww,
      wh,
      display.workArea,
    )
    x = pos.x
    y = pos.y
  }

  const win = new BrowserWindow({
    x,
    y,
    width: ww,
    height: wh,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    closable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    // Keep fully invisible until we explicitly show after anchor is locked.
    opacity: 0,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      backgroundThrottling: false,
      additionalArguments: [roleArg(WindowRole.Mini)],
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Belt-and-suspenders: never allow auto show.
  win.setOpacity(0)

  activeFlow = flow
  activePane = pane
  if (status.helperPath) lastHelperPath = status.helperPath
  loadFloat(win, status, flow, pane)

  win.on('closed', () => {
    stopPoll()
    doctorPoll = null
    activeFlow = null
    activePane = null
    systemSettingsAnchor = null
    if (floatWindow === win) floatWindow = null
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      closeComputerUsePermissionFloat()
    }
  })

  floatWindow = win
  return win
}

/** Fit the frameless window to the card content measured in the renderer. */
export function resizeComputerUsePermissionFloat(width: number, height: number): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  // Ignore resize while still invisible — avoid intermediate paints jumping.
  if (!floatWindow.isVisible() || floatWindow.getOpacity() < 0.5) return
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  const w = Math.round(
    Math.min(PERMISSION_FLOAT_MAX_WIDTH, Math.max(PERMISSION_FLOAT_MIN_WIDTH, width)),
  )
  const h = Math.round(
    Math.min(PERMISSION_FLOAT_MAX_HEIGHT, Math.max(PERMISSION_FLOAT_MIN_HEIGHT, height)),
  )
  const [prevW, prevH] = floatWindow.getContentSize()
  if (prevW === w && prevH === h) return
  floatWindow.setContentSize(w, h)
  if (systemSettingsAnchor) {
    placeLeftOfSystemSettings(floatWindow, systemSettingsAnchor)
  }
}

export function isComputerUsePermissionFloatOpen(): boolean {
  return floatWindow != null && !floatWindow.isDestroyed() && floatWindow.isVisible()
}

function resolveGuidedStartPane(status: ComputerUsePermissionStatus): PrivacyPane | null {
  if (status.accessibility !== 'granted') return 'accessibility'
  if (status.screenRecording !== 'granted') return 'screenRecording'
  return null
}

/**
 * Show the drag chip.
 * - flow=guided: multi-step (AX → Continue → Screen Recording)
 * - flow=single: one pane only
 */
export function showComputerUsePermissionFloat(
  status: ComputerUsePermissionStatus,
  options: {
    flow: PermissionFloatFlow
    /** Required for single; optional for guided (defaults to first missing). */
    pane?: PrivacyPane
    pollStatus?: () => Promise<ComputerUsePermissionStatus>
  },
): void {
  if (process.platform !== 'darwin') return
  if (status.error) return
  if (!status.helperPath) return

  const flow = options.flow
  const pane: PrivacyPane | null =
    flow === 'single'
      ? (options.pane ?? null)
      : (options.pane ?? resolveGuidedStartPane(status))

  if (!pane) return

  if (flow === 'single') {
    if (pane === 'accessibility' && status.accessibility === 'granted') return
    if (pane === 'screenRecording' && status.screenRecording === 'granted') return
  } else if (status.reason === 'already_granted') {
    return
  }

  // Cancel any in-flight show sequence and destroy a visible float immediately
  // so we never leave a chip on screen while re-opening Settings.
  showGeneration += 1
  const generation = showGeneration
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
    floatWindow = null
  }
  systemSettingsAnchor = null

  void openSettingsThenShowFloat(status, flow, pane, generation)
  startGrantedPoll(options.pollStatus)
}

/**
 * Guided only: user clicked Continue after Accessibility — open Screen Recording.
 */
export function continueComputerUsePermissionStep(): void {
  if (process.platform !== 'darwin') return
  if (activeFlow !== 'guided') return
  activePane = 'screenRecording'
  broadcastPermissionStatus({
    pane: 'screenRecording',
    flow: 'guided',
  })

  const status: ComputerUsePermissionStatus = {
    requested: true,
    accessibility: 'granted',
    screenRecording: 'missing',
    helperPath: lastHelperPath,
  }
  showGeneration += 1
  const generation = showGeneration
  // Tear down current chip while we switch panes — recreate under Screen Recording.
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
    floatWindow = null
  }
  systemSettingsAnchor = null
  void openSettingsThenShowFloat(status, 'guided', 'screenRecording', generation)
}

async function openSettingsThenShowFloat(
  status: ComputerUsePermissionStatus,
  flow: PermissionFloatFlow,
  pane: PrivacyPane,
  generation: number,
): Promise<void> {
  // 1) Open System Settings first — no float window exists yet.
  openComputerUsePrivacyPane(pane)

  // 2) Wait until System Settings is actually on screen.
  const bounds = await waitForSystemSettingsBounds()
  if (generation !== showGeneration) return

  systemSettingsAnchor = bounds

  // 3) Create the float already at the anchored position, still opacity 0.
  const win = createHiddenFloatAt(status, flow, pane, bounds)
  if (generation !== showGeneration || win.isDestroyed()) return

  await waitForContentReady(win)
  if (generation !== showGeneration || win.isDestroyed()) return

  // 4) Refresh bounds (Settings may have finished animating) and lock position.
  const fresh = (await getMacSystemSettingsBounds()) ?? bounds
  if (fresh) {
    systemSettingsAnchor = fresh
    placeLeftOfSystemSettings(win, fresh)
  } else {
    placeFallback(win)
  }

  if (generation !== showGeneration || win.isDestroyed()) return

  // 5) Only now become visible.
  win.setOpacity(0)
  win.showInactive()
  // Next tick so the first painted frame is already at the final position.
  setTimeout(() => {
    if (generation !== showGeneration || win.isDestroyed()) return
    win.setOpacity(1)
    broadcastPermissionStatus(status)
  }, 16)
}

function startGrantedPoll(
  pollStatus?: () => Promise<ComputerUsePermissionStatus>,
): void {
  stopPoll()
  doctorPoll = pollStatus ?? null
  if (!doctorPoll) return

  pollTimer = setInterval(() => {
    void (async () => {
      if (!doctorPoll) return
      try {
        const next = await doctorPoll()
        broadcastPermissionStatus(next)
      } catch {
        // helper may be restarting
      }
    })()
  }, 1000)
}

export function closeComputerUsePermissionFloat(): void {
  showGeneration += 1
  stopPoll()
  doctorPoll = null
  activeFlow = null
  activePane = null
  systemSettingsAnchor = null
  const win = floatWindow
  floatWindow = null
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
}

export function destroyComputerUsePermissionFloat(): void {
  closeComputerUsePermissionFloat()
}
