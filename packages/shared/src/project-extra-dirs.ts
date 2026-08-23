/**
 * Project workspace folders — the SuperOne-owned, harness-neutral directory
 * scope behind Edit Project.
 *
 * Lives in `shared` because BOTH project catalogs persist it (the desktop
 * `projects` table and the node `ProjectRegistry`) and they must not drift:
 * a folder accepted on a remote project has to be accepted on a local one.
 *
 * Node-free on purpose — the Edit Project dialog reads the cap from here, and
 * Vite's `node:*` shim throws on the *import binding*, so a single top-level
 * `node:path` import anywhere in this module takes the renderer down before a
 * line of it runs. Anything needing the real filesystem semantics belongs in
 * `project-extra-dirs-node.ts`.
 */

/**
 * Cap on project workspace folders.
 *
 * Deliberately well under the 64-dir transport cap: a turn's directory set is
 * the union of these and the session scope, so this budget has to leave the
 * session room. No harness config file contributes — SuperOne is the only
 * source of an agent's working directories.
 */
export const MAX_PROJECT_EXTRA_DIRS = 16

/**
 * Read `projects.extra_dirs_json` defensively.
 *
 * A malformed value must degrade to "no extra folders" rather than throw — this
 * runs on the path that renders the sidebar, and a single bad row should not
 * take the project list down with it.
 */
export function parseProjectExtraDirs(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return dedupeDirs(parsed.filter((d): d is string => typeof d === 'string' && d.trim().length > 0))
  } catch {
    return []
  }
}

export function dedupeDirs(dirs: readonly string[]): string[] {
  return [...new Set(dirs)]
}

/** What a caller wants done to a project's folder list. */
export interface ProjectExtraDirsPatch {
  /** Replace the whole list — Edit Project's Save, explicitly last-writer-wins. */
  extraDirs?: string[]
  /** Append these — `/add-dir`. */
  addExtraDirs?: string[]
  /** Drop these — `/add-dir`'s remove. */
  removeExtraDirs?: string[]
}

/**
 * Resolve a folder patch against what the catalog currently holds.
 *
 * `/add-dir` adds ONE folder, so it travels as a delta rather than as a whole
 * array. Sending the array would make two windows — or two edits spanning one
 * round trip — race to replace each other's list, and the loser's folder would
 * be silently deleted. Resolving the delta inside the catalog's own write is
 * what lets concurrent adds compose instead of clobber.
 *
 * Edit Project keeps the whole-array form on purpose: it is a form submission,
 * and last-writer-wins is the behaviour a Save button promises.
 *
 * Returns `null` when the patch says nothing about folders, which the callers
 * turn into "leave the column alone".
 */
export function resolveProjectExtraDirs(
  current: readonly string[],
  patch: ProjectExtraDirsPatch,
): string[] | null {
  if (patch.extraDirs !== undefined) return [...patch.extraDirs]
  if (patch.addExtraDirs === undefined && patch.removeExtraDirs === undefined) return null
  const removed = new Set(patch.removeExtraDirs ?? [])
  return [...current.filter((d) => !removed.has(d)), ...(patch.addExtraDirs ?? [])]
}
