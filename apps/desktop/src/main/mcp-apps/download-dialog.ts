import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { t } from '../i18n'

/** The native save dialog is the download confirmation; its message names the App. */
export async function chooseMcpAppDownloadPath(server: string, name: string): Promise<string | null> {
  const options = { defaultPath: join(app.getPath('downloads'), name), message: t('mcpApp.downloadMessage', { server, name }) }
  const window = BrowserWindow.getFocusedWindow()
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}
