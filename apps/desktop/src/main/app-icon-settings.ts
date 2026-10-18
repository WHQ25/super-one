import { statSync } from 'node:fs'
import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { applyAppIcon, clearStoredCustomIcons, storeCustomIcon } from './app-icon'
import { saveAppSettings } from './app-settings-service'
import { t } from './i18n'

function requireDevelopment(): void {
  if (!is.dev) throw new Error('Custom application icons are available in development builds only')
}

function saveIcon(png: Buffer | null) {
  requireDevelopment()
  if (png && nativeImage.createFromBuffer(png).isEmpty()) throw new Error('App icon must be a valid image')
  const storedPath = png ? storeCustomIcon(png) : null
  if (!png) clearStoredCustomIcons()
  const settings = saveAppSettings({ customAppIconPath: storedPath })
  applyAppIcon(storedPath, BrowserWindow.getAllWindows())
  return settings
}

/** Shared persistence and native-window effects for the settings UI and agent proposals. */
export async function setAppIconFile(filePath: string | null) {
  requireDevelopment()
  if (filePath === null) return saveIcon(null)
  if (statSync(filePath).size > 10 * 1024 * 1024) throw new Error('App icon image must be at most 10 MB')
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error('Cannot decode the app icon image')
  return saveIcon(image.toPNG())
}

export function registerAppIconIpc(getMainWindow: () => BrowserWindow): void {
  if (!is.dev) return
  ipcMain.handle(AgentIpcChannels.APP_ICON_PICK_FILE, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: t('settings.general.appIcon.label'), properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(AgentIpcChannels.APP_ICON_SET, (_event, dataUri: string) => {
    const match = /^data:image\/png;base64,(.+)$/.exec(dataUri ?? '')
    if (!match) throw new Error('App icon must be a PNG data URI')
    return saveIcon(Buffer.from(match[1], 'base64'))
  })
  ipcMain.handle(AgentIpcChannels.APP_ICON_RESET, () => saveIcon(null))
}
