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

export function dedupeDirs(dirs: readonly string[]): string[] {
  return [...new Set(dirs)]
}
