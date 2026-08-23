import { resolve } from 'node:path'
import { dedupeDirs, MAX_PROJECT_EXTRA_DIRS } from './project-extra-dirs'

/**
 * The half of project workspace folders that needs a real filesystem.
 *
 * Split from `project-extra-dirs.ts` so the renderer can read the cap and parse
 * a stored column without importing `node:path` — see that file's header.
 */

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
