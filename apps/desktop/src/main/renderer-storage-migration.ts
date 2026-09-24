/**
 * One-time copy of the renderer's localStorage from the file:// origin it used
 * to load from to `superone-renderer://app` (see renderer-protocol.ts). Stores
 * hydrate synchronously at module load, so this must finish before the first
 * renderer window opens. Keys already set at the new origin win.
 */
import { WebContentsView } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from './logger'
import { RENDERER_ORIGIN } from './renderer-protocol'

const MARKER = '.renderer-storage-migrated'

export type StorageEntries = Array<[string, string]>

/** The entries to write at the new origin: everything it does not already have. */
export function pendingStorageEntries(legacy: StorageEntries, current: StorageEntries): StorageEntries {
  const present = new Set(current.map(([key]) => key))
  return legacy.filter(([key]) => !present.has(key))
}

export async function migrateRendererLocalStorage(userData: string, tempDir: string): Promise<void> {
  const marker = join(userData, MARKER)
  if (existsSync(marker)) return
  // Windowless, so closing it can never trigger window-all-closed.
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } })
  const contents = view.webContents
  try {
    // Every file:// document shares one storage origin; an empty one runs nothing.
    const blank = join(tempDir, 'superone-storage-export.html')
    writeFileSync(blank, '<!doctype html>')
    await contents.loadFile(blank)
    const legacy: StorageEntries = await contents.executeJavaScript('Object.entries(localStorage)')
    if (legacy.length > 0) {
      // A missing path answers 404 but still commits a document at the new origin.
      await contents.loadURL(`${RENDERER_ORIGIN}/storage-migration`)
      const current: StorageEntries = await contents.executeJavaScript('Object.entries(localStorage)')
      const pending = pendingStorageEntries(legacy, current)
      await contents.executeJavaScript(
        `for (const [k, v] of ${JSON.stringify(pending)}) localStorage.setItem(k, v)`,
      )
      log.info('[renderer-storage] migrated %d of %d localStorage keys to %s', pending.length, legacy.length, RENDERER_ORIGIN)
    }
    writeFileSync(marker, '')
  } catch (err) {
    // Not marked: the next launch retries rather than silently dropping the user's state.
    log.warn('[renderer-storage] migration failed: %s', err instanceof Error ? err.message : String(err))
  } finally {
    contents.close()
  }
}
