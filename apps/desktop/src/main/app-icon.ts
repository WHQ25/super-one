import { existsSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'

const STORED_ICON_PREFIX = 'custom-app-icon'

let cachedIcon: NativeImage | null = null

function defaultIconPath(): string {
  return is.dev
    ? join(app.getAppPath(), 'build', 'icon.png')
    : join(process.resourcesPath, 'icon.png')
}

function buildIcon(customPath: string | null): NativeImage | null {
  const path = customPath && existsSync(customPath) ? customPath : defaultIconPath()
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? null : image
}

export function getAppIcon(): NativeImage | null {
  return cachedIcon
}

export function applyAppIcon(customPath: string | null, windows: Iterable<BrowserWindow>): void {
  const image = buildIcon(customPath)
  if (!image) return
  cachedIcon = image
  app.dock?.setIcon(image)
  for (const win of windows) {
    if (!win.isDestroyed()) win.setIcon(image)
  }
}

export function storeCustomIcon(pngBuffer: Buffer): string {
  clearStoredCustomIcons()
  const dest = join(app.getPath('userData'), `${STORED_ICON_PREFIX}-${Date.now()}.png`)
  writeFileSync(dest, pngBuffer)
  return dest
}

export function clearStoredCustomIcons(): void {
  const dir = app.getPath('userData')
  for (const name of readdirSync(dir)) {
    if (name.startsWith(STORED_ICON_PREFIX)) {
      rmSync(join(dir, name), { force: true })
    }
  }
}
