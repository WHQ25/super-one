import { toast } from 'sonner'
import i18n from 'i18next'

/**
 * Persist project workspace folders to the SuperOne project catalog.
 *
 * `environment.updateProject` takes the **whole** folder array, not a delta.
 * That makes two rules load-bearing, and neither is optional:
 *
 * 1. Commit to the store first. The next edit computes its array from store
 *    state, so an un-committed edit is an edit the next one silently drops.
 * 2. Serialize per project. Even with (1), two overlapping round-trips can land
 *    out of order and leave the catalog holding the older array.
 *
 * The catalog's answer is authoritative on the way back — it resolves, dedupes
 * and caps — so a write that was normalized is reflected rather than assumed.
 */
const pendingWrites = new Map<string, Promise<void>>()

export interface ProjectExtraDirsSink {
  /** Write the folder list into `ProjectState.projectExtraDirs`. */
  commit: (dirs: string[]) => void
  /** Re-read the catalog. Used to recover the truth after a failed write. */
  reload: () => Promise<void>
}

export function writeProjectExtraDirs(
  projectKey: string,
  next: string[],
  sink: ProjectExtraDirsSink,
): Promise<void> {
  sink.commit(next)
  const chain = (pendingWrites.get(projectKey) ?? Promise.resolve())
    .then(async () => {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(projectKey)
      const saved = await window.environment.updateProject(remote?.connectionId ?? 'local', {
        path: remote?.path ?? projectKey,
        extraDirs: next,
      })
      sink.commit([...(saved?.extraDirs ?? next)])
    })
    .catch(async (err) => {
      console.error('[projectExtraDirs] Failed to persist project folders:', err)
      toast.error(i18n.t('chat.addDir.errors.saveFailed', {
        defaultValue: 'Could not save the project folders',
      }))
      // A lease denial, an offline node or a database error all leave the
      // catalog as the only party that knows what actually survived.
      await sink.reload().catch(() => {})
    })
  pendingWrites.set(projectKey, chain)
  void chain.finally(() => {
    if (pendingWrites.get(projectKey) === chain) pendingWrites.delete(projectKey)
  })
  return chain
}

/** Drop queued chains between tests — the map outlives a store recreation. */
export function resetProjectExtraDirWrites(): void {
  pendingWrites.clear()
}
