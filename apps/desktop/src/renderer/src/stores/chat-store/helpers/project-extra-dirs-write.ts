import { toast } from 'sonner'
import i18n from 'i18next'
import type { ProjectExtraDirsPatch } from '@superone/shared/project-extra-dirs'

/**
 * Persist a change to a project's workspace folders.
 *
 * `/add-dir` adds or drops ONE folder, and it travels as a delta
 * (`addExtraDirs` / `removeExtraDirs`) rather than as the resulting array. Main
 * resolves it against stored state inside its own write, which is the only
 * boundary that two BrowserWindows share — a renderer-local queue cannot stop
 * two windows from computing `[A]` and `[B]` from `[]` and having the second
 * whole-array replace delete the first one's folder.
 *
 * Edit Project keeps the whole-array form: it is a form submission, and
 * last-writer-wins is what a Save button promises.
 *
 * Two renderer-side rules still apply on top of that:
 *
 * 1. Commit optimistically, so the next edit computes from this one and the
 *    composer hint does not lag a round trip behind the click.
 * 2. Serialize per project, and let ONLY the newest write publish authoritative
 *    state. An older response carries a list that predates every edit queued
 *    behind it, so committing it would drop those edits back out of the store
 *    and let a subsequent edit compute from a list missing them.
 */
const pendingWrites = new Map<string, Promise<void>>()
const generations = new Map<string, number>()

export interface ProjectExtraDirsSink {
  /** Write the folder list into `ProjectState.projectExtraDirs`. */
  commit: (dirs: string[]) => void
}

/**
 * Read a project's stored folders. Returns null when the catalog cannot be
 * reached or does not know this project.
 *
 * Reads rather than writes so the caller decides whether the answer is still
 * worth publishing — a read that resolves after a newer edit has already
 * committed must not be allowed to overwrite it.
 *
 * `listProjects('local')` is served by the desktop catalog, so local and remote
 * share one code path and no separate read IPC is needed.
 */
export async function readProjectExtraDirs(projectKey: string): Promise<string[] | null> {
  const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
  const remote = parseRemoteProjectKey(projectKey)
  try {
    const projects = await window.environment.listProjects(remote?.connectionId ?? 'local')
    const hit = projects.find((p) => p.path === (remote?.path ?? projectKey))
    return [...(hit?.extraDirs ?? [])]
  } catch (err) {
    console.warn('[projectExtraDirs] Failed to read project catalog:', err)
    return null
  }
}

export function writeProjectExtraDirs(
  projectKey: string,
  /** What the store should show right away. */
  optimistic: string[],
  patch: ProjectExtraDirsPatch,
  sink: ProjectExtraDirsSink,
): Promise<void> {
  const generation = (generations.get(projectKey) ?? 0) + 1
  generations.set(projectKey, generation)
  const isNewest = () => generations.get(projectKey) === generation

  sink.commit(optimistic)
  const chain = (pendingWrites.get(projectKey) ?? Promise.resolve())
    .then(async () => {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(projectKey)
      const saved = await window.environment.updateProject(remote?.connectionId ?? 'local', {
        path: remote?.path ?? projectKey,
        ...patch,
      })
      // The catalog resolves, dedupes and caps, so its answer beats the
      // optimistic one — but only while this is still the newest edit.
      if (isNewest()) sink.commit([...(saved?.extraDirs ?? optimistic)])
    })
    .catch(async (err) => {
      console.error('[projectExtraDirs] Failed to persist project folders:', err)
      toast.error(i18n.t('chat.addDir.errors.saveFailed'))
      // A lease denial, an offline node or a database error all leave the
      // catalog as the only party that knows what actually survived. The
      // generation is re-checked AFTER the read, not before it: an edit made
      // while the read was in flight has already committed, and this answer
      // predates it.
      if (!isNewest()) return
      const recovered = await readProjectExtraDirs(projectKey)
      if (recovered && isNewest()) sink.commit(recovered)
    })
  pendingWrites.set(projectKey, chain)
  void chain.finally(() => {
    if (pendingWrites.get(projectKey) === chain) pendingWrites.delete(projectKey)
  })
  return chain
}

/** Drop queued chains between tests — the maps outlive a store recreation. */
export function resetProjectExtraDirWrites(): void {
  pendingWrites.clear()
  generations.clear()
}
