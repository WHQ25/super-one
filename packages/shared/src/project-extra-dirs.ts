import { resolve } from 'node:path'

/**
 * Project workspace folders — the SuperOne-owned, harness-neutral directory
 * scope behind Edit Project.
 *
 * Lives in `shared` because BOTH project catalogs persist it (the desktop
 * `projects` table and the node `ProjectRegistry`) and they must not drift:
 * a folder accepted on a remote project has to be accepted on a local one.
 */

/**
 * Cap on project workspace folders.
 *
 * Deliberately well under the 64-dir transport cap: a turn's directory set is
 * the union of these, the harness config scopes (`.claude/settings*.json`,
 * `.codex/config.toml`) and the session scope, so this budget has to leave the
 * other three room.
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

/**
 * Normalize a user-supplied folder list before it is persisted.
 *
 * Existence is deliberately NOT required: a folder on an unmounted volume
 * should survive an unrelated rename, and the dialog surfaces missing paths as
 * a warning instead. The project root is dropped because it is already the cwd
 * — re-adding it would show a duplicate chip in the composer hint.
 */
export function normalizeProjectExtraDirs(dirs: readonly string[], projectPath: string): string[] {
  const root = resolve(projectPath)
  const normalized = dirs
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .map((d) => resolve(d.trim()))
    .filter((d) => d !== root)
  return dedupeDirs(normalized).slice(0, MAX_PROJECT_EXTRA_DIRS)
}

function dedupeDirs(dirs: readonly string[]): string[] {
  return [...new Set(dirs)]
}
