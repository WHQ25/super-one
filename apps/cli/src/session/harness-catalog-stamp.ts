import { writeFileSync } from 'node:fs'
import { nodePaths } from '../config'
import { harnessAdvertisementKey } from '@superone/shared/environment'

/**
 * Tell a running node the catalog was written from this process.
 * A missing or unwritable node home must not fail the CLI command: the next
 * connect reads `environment.descriptor`.
 */
export function signalHarnessCatalogChanged(nodeHome: string): void {
  try {
    writeFileSync(nodePaths(nodeHome).harnessCatalogStamp, `${Date.now()}\n`)
  } catch {
    // The node is down, or this home is not writable.
  }
}

/**
 * Remembers the advertised set and publishes only when a stamp shows a new one.
 * The first sample is the set already loaded at process start.
 */
export function createHarnessCatalogNotifier(
  readIds: () => readonly string[],
  publish: (ids: readonly string[]) => void,
): { note(): boolean } {
  let lastKey = harnessAdvertisementKey(readIds())
  return {
    note() {
      const ids = [...readIds()]
      const next = harnessAdvertisementKey(ids)
      if (next === lastKey) return false
      lastKey = next
      publish(ids)
      return true
    },
  }
}
