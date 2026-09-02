import { BrowserWindow } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { AgentIpcChannels, type UpdateEvent } from '@superone/shared/agent-types'
import { prefetchEnabledHarnessesForAppUpdate } from './harness/service'

let win: BrowserWindow | null = null
let updaterState: UpdateEvent['type'] = 'not-available'
/**
 * Last event pushed to the renderer. The startup check usually resolves before
 * the renderer has mounted its listener (and a window reload drops the state
 * entirely), so the renderer pulls this snapshot on mount instead of relying on
 * having been alive for the push.
 */
let lastEvent: UpdateEvent | null = null
let menuLabel = 'Check for Updates...'
let menuEnabled = true
let onMenuChange: (() => void) | null = null

/** Version of the app package that finished downloading (may await harness phase). */
let pendingDownloadedVersion: string | null = null
/** True only when app + enabled harness pre-fetch succeeded — Restart allowed. */
let updateFullyReady = false
let harnessPrefetchInflight: Promise<void> | null = null
/** True after the user clicks Restart — `before-quit` skips the confirm dialog. */
let installingUpdate = false

/**
 * electron-updater MacUpdater fields that are not in the public types.
 * `autoInstallOnAppQuit` gates Squirrel.Mac's fetch of the local zip at
 * download time; we keep it false until harness pre-fetch succeeds, so we
 * have to kick Squirrel ourselves or Restart waits forever.
 */
type MacUpdaterInternals = {
  squirrelDownloadedUpdate?: boolean
  nativeUpdater?: { checkForUpdates: () => void }
}

function macUpdater(): MacUpdaterInternals {
  return autoUpdater as unknown as MacUpdaterInternals
}

function stageSquirrelMacUpdate(): void {
  const mac = macUpdater()
  if (mac.squirrelDownloadedUpdate) return
  if (typeof mac.nativeUpdater?.checkForUpdates !== 'function') return
  log.info('[updater] staging update with Squirrel.Mac')
  try {
    mac.nativeUpdater.checkForUpdates()
  } catch (err) {
    log.warn(
      '[updater] Squirrel.Mac staging failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/** Dev-only: version held at `available` until the user triggers download. */
let simulatedPendingVersion: string | null = null
let simulateTimers: ReturnType<typeof setTimeout>[] = []

function clearSimulateTimers(): void {
  for (const t of simulateTimers) clearTimeout(t)
  simulateTimers = []
}

function send(event: UpdateEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send(AgentIpcChannels.UPDATER_EVENT, event)
  updaterState = event.type
  lastEvent = event
  const prevLabel = menuLabel
  const prevEnabled = menuEnabled
  switch (event.type) {
    case 'checking':
      menuLabel = 'Checking for Updates...'
      menuEnabled = false
      break
    case 'available':
      menuLabel = 'Download Update'
      menuEnabled = true
      break
    case 'download-progress':
      menuLabel =
        event.phase === 'harness' ? 'Preparing Harnesses...' : 'Downloading Update...'
      menuEnabled = false
      break
    case 'harness-error':
      menuLabel = 'Retry Harness Download'
      menuEnabled = true
      break
    case 'downloaded':
      menuLabel = 'Restart to Update'
      menuEnabled = true
      break
    default:
      menuLabel = 'Check for Updates...'
      menuEnabled = true
      break
  }
  if (menuLabel !== prevLabel || menuEnabled !== prevEnabled) onMenuChange?.()
}

function setFullyReady(ready: boolean): void {
  updateFullyReady = ready
  try {
    // Only auto-install on quit when the atomic package (app + harness) is ready.
    autoUpdater.autoInstallOnAppQuit = ready
  } catch {
    /* autoUpdater may be unavailable in some test hosts */
  }
}

/**
 * After the app binary is on disk: pre-fetch enabled harness pins for the
 * target version, then emit `downloaded` (strict) or `harness-error`.
 */
async function runHarnessPrefetchPhase(version: string): Promise<void> {
  pendingDownloadedVersion = version
  setFullyReady(false)
  send({ type: 'download-progress', percent: 0, phase: 'harness' })

  try {
    const result = await prefetchEnabledHarnessesForAppUpdate(version, (event) => {
      const percent =
        event.total > 0
          ? Math.min(100, Math.round((event.received / event.total) * 100))
          : 0
      send({
        type: 'download-progress',
        percent,
        phase: 'harness',
        harnessId: event.harnessId,
      })
    })
    if (result.failed.length > 0) {
      const message = result.failed.map((f) => `${f.id}: ${f.error}`).join('\n')
      log.warn(`[updater] harness prefetch failed for ${version}: ${message}`)
      setFullyReady(false)
      send({ type: 'harness-error', version, message })
      return
    }
    log.info(
      `[updater] harness prefetch ok for ${version} (${result.prepared.length} harnesses)`,
    )
    setFullyReady(true)
    // MacUpdater skipped native checkForUpdates() because autoInstallOnAppQuit
    // was false during download. Stage the zip now so Restart / quit-to-install
    // do not deadlock waiting for a Squirrel event that never comes.
    stageSquirrelMacUpdate()
    send({ type: 'downloaded', version })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`[updater] harness prefetch error for ${version}: ${message}`)
    setFullyReady(false)
    send({ type: 'harness-error', version, message })
  }
}

function startHarnessPrefetch(version: string): void {
  if (harnessPrefetchInflight) return
  harnessPrefetchInflight = runHarnessPrefetchPhase(version).finally(() => {
    harnessPrefetchInflight = null
  })
}

export function getUpdaterState(): UpdateEvent['type'] {
  return updaterState
}

/** Last pushed updater event, replayed by a renderer that mounted too late. */
export function getUpdaterSnapshot(): UpdateEvent | null {
  return lastEvent
}

/**
 * Re-point the push target after the main window is recreated (macOS activate
 * with all windows closed). `initUpdater` only runs once, so without this the
 * captured window stays destroyed and every later event is dropped.
 */
export function setUpdaterWindow(mainWindow: BrowserWindow): void {
  win = mainWindow
}

export function getUpdateMenuState(): { label: string; enabled: boolean } {
  return { label: menuLabel, enabled: menuEnabled }
}

export function setOnMenuChange(fn: () => void): void {
  onMenuChange = fn
}

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow
  installingUpdate = false
  lastEvent = null
  const testUpdater = process.env.TEST_UPDATER === '1'
  if (is.dev && !testUpdater) return
  autoUpdater.logger = log
  // Check automatically; wait for the user to click Download/Update before fetching the binary.
  autoUpdater.autoDownload = false
  // Strict atomic update: only install-on-quit after harness pre-fetch succeeds.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  if (testUpdater) autoUpdater.forceDevUpdateConfig = true
  autoUpdater.on('checking-for-update', () => {
    send({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    installingUpdate = false
    setFullyReady(false)
    pendingDownloadedVersion = null
    send({
      type: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    send({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    send({
      type: 'download-progress',
      percent: Math.round(progress.percent),
      phase: 'app',
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    // Do not emit `downloaded` yet — harness phase must complete first.
    startHarnessPrefetch(info.version)
  })

  autoUpdater.on('error', (err) => {
    setFullyReady(false)
    send({ type: 'error', message: err.message })
  })

  // Only check on startup — further checks are user-driven (app menu / settings).
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] Initial check failed:', err.message)
  })
}

export function isInstallingUpdate(): boolean {
  return installingUpdate
}

export function installUpdate(): void {
  if (!updateFullyReady) {
    log.warn('[updater] installUpdate refused: harness package not ready')
    return
  }
  installingUpdate = true
  const mac = macUpdater()
  // MacUpdater.quitAndInstall() only calls native checkForUpdates() when
  // autoInstallOnAppQuit is false. Staging above may still be in flight.
  if (!mac.squirrelDownloadedUpdate) {
    try {
      autoUpdater.autoInstallOnAppQuit = false
    } catch {
      /* autoUpdater may be unavailable in some test hosts */
    }
  }
  log.info('[updater] quitAndInstall')
  autoUpdater.quitAndInstall()
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] Manual check failed:', err.message)
    send({ type: 'error', message: err.message })
  })
}

/**
 * Start downloading a previously announced update.
 * In pure-dev simulate mode (no real updater), continues the fake progress sequence.
 */
export function downloadUpdate(): void {
  if (simulatedPendingVersion) {
    const version = simulatedPendingVersion
    simulatedPendingVersion = null
    clearSimulateTimers()
    simulateTimers = [
      setTimeout(() => send({ type: 'download-progress', percent: 0, phase: 'app' }), 0),
      setTimeout(() => send({ type: 'download-progress', percent: 30, phase: 'app' }), 500),
      setTimeout(() => send({ type: 'download-progress', percent: 60, phase: 'app' }), 1000),
      setTimeout(() => send({ type: 'download-progress', percent: 90, phase: 'app' }), 1500),
      setTimeout(() => send({ type: 'download-progress', percent: 100, phase: 'app' }), 2000),
      // Simulated harness phase (no real download in pure-dev).
      setTimeout(() => send({ type: 'download-progress', percent: 0, phase: 'harness' }), 2200),
      setTimeout(
        () =>
          send({
            type: 'download-progress',
            percent: 50,
            phase: 'harness',
            harnessId: 'claude',
          }),
        2600,
      ),
      setTimeout(
        () =>
          send({
            type: 'download-progress',
            percent: 100,
            phase: 'harness',
            harnessId: 'claude',
          }),
        3000,
      ),
      setTimeout(() => {
        setFullyReady(true)
        pendingDownloadedVersion = version
        send({ type: 'downloaded', version })
      }, 3200),
    ]
    return
  }

  setFullyReady(false)
  autoUpdater.downloadUpdate().catch((err) => {
    log.warn('[updater] Download failed:', err.message)
    send({ type: 'error', message: err.message })
  })
}

/** Retry only the harness pre-fetch after `harness-error` (app binary already local). */
export function retryUpdateHarnessPrefetch(): void {
  const version = pendingDownloadedVersion
  if (!version) {
    log.warn('[updater] retry harness: no pending downloaded version')
    return
  }
  if (harnessPrefetchInflight) return
  startHarnessPrefetch(version)
}


export function simulateUpdate(): void {
  clearSimulateTimers()
  const version = '99.0.0'
  simulatedPendingVersion = version
  setFullyReady(false)
  pendingDownloadedVersion = null
  send({ type: 'checking' })
  simulateTimers = [setTimeout(() => send({ type: 'available', version }), 1000)]
}

export function simulateNotAvailable(): void {
  clearSimulateTimers()
  simulatedPendingVersion = null
  setFullyReady(false)
  pendingDownloadedVersion = null
  send({ type: 'checking' })
  simulateTimers = [setTimeout(() => send({ type: 'not-available' }), 1000)]
}
