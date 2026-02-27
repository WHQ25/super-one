import { BrowserWindow } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { AgentIpcChannels, type UpdateEvent } from '../shared/agent-types'

declare const __UPDATER_TOKEN__: string

let win: BrowserWindow | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null
let updaterState: UpdateEvent['type'] = 'not-available'
let menuLabel = 'Check for Updates...'
let menuEnabled = true
let onMenuChange: (() => void) | null = null

function send(event: UpdateEvent): void {
  win?.webContents.send(AgentIpcChannels.UPDATER_EVENT, event)
  updaterState = event.type
  const prevLabel = menuLabel
  const prevEnabled = menuEnabled
  switch (event.type) {
    case 'checking':
      menuLabel = 'Checking for Updates...'
      menuEnabled = false
      break
    case 'available':
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

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow
  const testUpdater = process.env.TEST_UPDATER === '1'
  if (is.dev && !testUpdater) return
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  if (testUpdater) autoUpdater.forceDevUpdateConfig = true
  if (__UPDATER_TOKEN__) {
    process.env.GH_TOKEN = __UPDATER_TOKEN__
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

  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] Initial check failed:', err.message)
  })

  checkInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] Periodic check failed:', err.message)
    })
  }, 4 * 60 * 60 * 1000)
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

export function simulateUpdate(): void {
  const version = '99.0.0'
  send({ type: 'checking' })
  setTimeout(() => send({ type: 'available', version }), 1000)
  setTimeout(() => send({ type: 'download-progress', percent: 0 }), 2000)
  setTimeout(() => send({ type: 'download-progress', percent: 30 }), 2500)
  setTimeout(() => send({ type: 'download-progress', percent: 60 }), 3000)
  setTimeout(() => send({ type: 'download-progress', percent: 90 }), 3500)
  setTimeout(() => send({ type: 'download-progress', percent: 100 }), 4000)
  setTimeout(() => send({ type: 'downloaded', version }), 4500)
}

export function simulateNotAvailable(): void {
  send({ type: 'checking' })
  setTimeout(() => send({ type: 'not-available' }), 1000)
}

export function disposeUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
