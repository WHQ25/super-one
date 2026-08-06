import { BrowserWindow } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { AgentIpcChannels, type UpdateChannel, type UpdateEvent } from '@superone/shared/agent-types'
import { UPDATE_CHANNEL_TO_YML } from '@superone/shared/update-channels'

let win: BrowserWindow | null = null
let updaterState: UpdateEvent['type'] = 'not-available'
let menuLabel = 'Check for Updates...'
let menuEnabled = true
let onMenuChange: (() => void) | null = null

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
      menuLabel = 'Downloading Update...'
      menuEnabled = false
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

export function getUpdaterState(): UpdateEvent['type'] {
  return updaterState
}

export function getUpdateMenuState(): { label: string; enabled: boolean } {
  return { label: menuLabel, enabled: menuEnabled }
}

export function setOnMenuChange(fn: () => void): void {
  onMenuChange = fn
}

export function initUpdater(mainWindow: BrowserWindow, channelPref?: UpdateChannel | null): void {
  win = mainWindow
  const testUpdater = process.env.TEST_UPDATER === '1'
  if (is.dev && !testUpdater) return
  autoUpdater.logger = log
  // Check automatically; wait for the user to click Download/Update before fetching the binary.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  if (testUpdater) autoUpdater.forceDevUpdateConfig = true
  if (channelPref) {
    autoUpdater.channel = UPDATE_CHANNEL_TO_YML[channelPref]
    log.info(`[updater] channel pref applied: ${channelPref} → ${autoUpdater.channel}`)
  }
  autoUpdater.on('checking-for-update', () => {
    send({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: info.version, releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined })
  })

  autoUpdater.on('update-not-available', () => {
    send({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    send({ type: 'download-progress', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send({ type: 'error', message: err.message })
  })

  // Only check on startup — further checks are user-driven (app menu / settings).
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] Initial check failed:', err.message)
  })
}

export function installUpdate(): void {
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
      setTimeout(() => send({ type: 'download-progress', percent: 0 }), 0),
      setTimeout(() => send({ type: 'download-progress', percent: 30 }), 500),
      setTimeout(() => send({ type: 'download-progress', percent: 60 }), 1000),
      setTimeout(() => send({ type: 'download-progress', percent: 90 }), 1500),
      setTimeout(() => send({ type: 'download-progress', percent: 100 }), 2000),
      setTimeout(() => send({ type: 'downloaded', version }), 2500),
    ]
    return
  }

  autoUpdater.downloadUpdate().catch((err) => {
    log.warn('[updater] Download failed:', err.message)
    send({ type: 'error', message: err.message })
  })
}

export function setUpdateChannel(channel: UpdateChannel | null): void {
  if (is.dev && process.env.TEST_UPDATER !== '1') return
  if (channel) {
    autoUpdater.channel = UPDATE_CHANNEL_TO_YML[channel]
    log.info(`[updater] channel changed to ${channel} → ${autoUpdater.channel}`)
  }
  autoUpdater.allowDowngrade = true
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      log.warn('[updater] post-channel-change check failed:', err.message)
    })
    .finally(() => {
      autoUpdater.allowDowngrade = false
    })
}

export function simulateUpdate(): void {
  clearSimulateTimers()
  const version = '99.0.0'
  simulatedPendingVersion = version
  send({ type: 'checking' })
  simulateTimers = [
    setTimeout(() => send({ type: 'available', version }), 1000),
  ]
}

export function simulateNotAvailable(): void {
  clearSimulateTimers()
  simulatedPendingVersion = null
  send({ type: 'checking' })
  simulateTimers = [
    setTimeout(() => send({ type: 'not-available' }), 1000),
  ]
}
