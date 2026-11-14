import { copyFileSync, unlinkSync } from 'fs'
import log from '../logger'
import { mediaFileGrants } from '../media-file-grants'
import { reserveDownloadPath, wakeDownloadDelivery } from '../agent/browser-download-store'
import { abandonZoneFile, sealZoneFile } from '../environment/zone-delivery'
import { tabDriver } from './browser-tab-drivers'

export interface ChromePageDownload {
  guid: string
  url: string
  filename: string
  path: string
  bytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  webContentsId: number
}

const MAX_CAPTURED = 20
const downloads: ChromePageDownload[] = []

export function noteChromePageDownload(item: ChromePageDownload): void {
  const existing = downloads.find((row) => row.guid === item.guid)
  if (existing) {
    existing.url = item.url || existing.url
    existing.filename = item.filename || existing.filename
    existing.path = item.path || existing.path
    existing.bytes = item.bytes
    existing.state = item.state
    existing.webContentsId = item.webContentsId
    return
  }
  downloads.unshift(item)
  downloads.length = Math.min(downloads.length, MAX_CAPTURED)
}

function grant(path: string): void {
  try {
    mediaFileGrants().add(path)
  } catch (err) {
    log.warn('[chrome-download] could not persist media grant for %s: %s', path, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Chrome already chose the save path. A remote session still needs the file
 * inside its zone, sealed the same way a built-in page download is when it
 * finishes. A second completion event must not copy or seal again.
 */
export function recordChromePageDownload(item: ChromePageDownload): void {
  const existing = downloads.find((row) => row.guid === item.guid)
  if (existing?.state === 'completed' && existing.path) {
    noteChromePageDownload({
      ...item,
      path: existing.path,
      filename: existing.filename || item.filename,
      state: 'completed',
    })
    return
  }
  const path = item.state === 'completed' && item.path ? finalizeChromePageDownload(item) : item.path
  noteChromePageDownload({ ...item, path })
}

function finalizeChromePageDownload(item: ChromePageDownload): string {
  const source = item.path
  grant(source)
  const driver = tabDriver(item.webContentsId)
  if (!driver?.connectionId) return source
  let target = ''
  try {
    target = reserveDownloadPath(item.filename || 'download', null, driver.sessionId, { connectionId: driver.connectionId })
    copyFileSync(source, target)
    grant(target)
    sealZoneFile({
      sessionId: driver.sessionId,
      path: target,
      origin: 'page-download',
      connectionId: driver.connectionId,
    })
    wakeDownloadDelivery(driver.connectionId)
    return target
  } catch (err) {
    if (target) {
      try { abandonZoneFile(driver.sessionId, target) } catch { /* the reservation may not have been taken */ }
      try { unlinkSync(target) } catch { /* the stub may already be gone */ }
    }
    log.warn('[chrome-download] could not file %s into the session zone: %s', item.url, err instanceof Error ? err.message : String(err))
    return source
  }
}

export function chromePageDownloads(): readonly ChromePageDownload[] {
  return downloads
}

export function resetChromePageDownloadsForTests(): void {
  downloads.length = 0
}
