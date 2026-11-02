import { watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import { HARNESS_CATALOG_CHANGED } from '@superone/shared/environment'
import { nodePaths } from '../config'
import { createHarnessCatalogNotifier } from './harness-catalog-stamp'

/** A directory watch event names the stamp, not the sqlite file beside it. */
export function isHarnessCatalogStamp(filename: string | null): boolean {
  if (!filename) return false
  const stamp = basename(nodePaths('').harnessCatalogStamp)
  return filename === stamp || filename.endsWith(`/${stamp}`) || filename.endsWith(`\\${stamp}`)
}

/**
 * Watch the node home and append `harness_catalog_changed` when the stamp
 * changes the advertised set. The directory is watched, not the file: rewriting
 * the stamp keeps delivering events. The same ids publish once.
 */
export function watchHarnessCatalogStamp(opts: {
  nodeHome: string
  environmentId: string
  readIds: () => readonly string[]
  append(input: {
    aggregateType: 'environment'
    aggregateId: string
    eventType: typeof HARNESS_CATALOG_CHANGED
    payload: { harnessIds: string[] }
  }): void
}): { close(): void } {
  const path = nodePaths(opts.nodeHome).harnessCatalogStamp
  const notifier = createHarnessCatalogNotifier(opts.readIds, (ids) => {
    opts.append({
      aggregateType: 'environment',
      aggregateId: opts.environmentId,
      eventType: HARNESS_CATALOG_CHANGED,
      payload: { harnessIds: [...ids] },
    })
  })
  let watcher: FSWatcher | null = null
  try {
    // Present before the watch starts so the first CLI rewrite is a change,
    // not the creation of an unwatched path. The sample above is unchanged.
    writeFileSync(path, '', { flag: 'a' })
    watcher = watch(opts.nodeHome, { persistent: false }, (_event, filename) => {
      if (!isHarnessCatalogStamp(filename ?? null)) return
      notifier.note()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    watcher = null
  }
  return {
    close() {
      watcher?.close()
      watcher = null
    },
  }
}
