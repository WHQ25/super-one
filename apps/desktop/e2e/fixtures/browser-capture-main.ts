/** Isolated real Electron guest; never reads the user's app profile. */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.setPath('userData', process.env.BROWSER_CAPTURE_PROFILE!)
void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 900, height: 600,
    webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true },
  })
  await window.loadFile(join(process.env.BROWSER_CAPTURE_BUILD!, 'host.html'))
})
app.on('window-all-closed', () => app.quit())
