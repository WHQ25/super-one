import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { shell, type IpcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { chromeBridgeHub } from './chrome-bridge-hub'
import { chromeExtensionDir } from './chrome-extension-install'
import { installedExtensionBrowserIds, openExtensionBrowserPage } from './open-extension-page'
import { variantId } from '../variant'

export interface ChromeBridgeStatus {
  connected: boolean
  browsers: string[]
  extensionDir: string
}

export function readChromeBridgeStatus(userHome = homedir()): ChromeBridgeStatus {
  return {
    connected: chromeBridgeHub.connected,
    browsers: chromeBridgeHub.browsers(),
    extensionDir: chromeExtensionDir(variantId(), userHome),
  }
}

/** Finder reveal of the unpacked extension the user loads once. */
export function revealChromeExtensionDir(): void {
  const dir = readChromeBridgeStatus().extensionDir
  mkdirSync(dir, { recursive: true })
  shell.showItemInFolder(dir)
}

export function onChromeBridgeConnection(listener: (status: ChromeBridgeStatus) => void): () => void {
  return chromeBridgeHub.onConnection(() => listener(readChromeBridgeStatus()))
}

export function registerChromeBridgeIpc(ipcMain: IpcMain, send: (channel: string, status: ChromeBridgeStatus) => void): void {
  ipcMain.handle(AgentIpcChannels.CHROME_BRIDGE_STATUS, () => readChromeBridgeStatus())
  ipcMain.handle(AgentIpcChannels.CHROME_BRIDGE_REVEAL, () => {
    revealChromeExtensionDir()
  })
  ipcMain.handle(AgentIpcChannels.CHROME_BRIDGE_LIST_BROWSERS, () => installedExtensionBrowserIds())
  ipcMain.handle(AgentIpcChannels.CHROME_BRIDGE_OPEN_EXTENSIONS, (_event, browserId: string) =>
    openExtensionBrowserPage(typeof browserId === 'string' ? browserId : ''),
  )
  onChromeBridgeConnection((status) => send(AgentIpcChannels.CHROME_BRIDGE_STATUS_CHANGED, status))
}
