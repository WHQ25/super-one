import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/**
 * `.gitignore` filtering for a remote directory listing.
 *
 * The desktop's own file picker does **not** do this — it applies a fixed
 * exclusion set and nothing else. This exists for the mobile mention browse,
 * where there is no keyboard to type past a project's generated output, and it
 * is opt-in per request so the desktop's behaviour is unchanged.
 *
 * Rules are read from the nearest `.gitignore` at or above the listed
 * directory, which is what git itself would apply to entries there. A project
 * with no `.gitignore` filters nothing.
 */
export function projectIgnoreFilter(directory: string): ((name: string, isDirectory: boolean) => boolean) | null {
  const rules = collectRules(directory)
  if (!rules) return null
  return (name, isDirectory) => rules.ignores(isDirectory ? `${name}/` : name)
}

function collectRules(directory: string): Ignore | null {
  let current = resolve(directory)
  const patterns: string[] = []
  // Walk up towards the repository root; a monorepo's rules usually live above
  // the directory being listed. The walk **stops at the repo**, as git does —
  // continuing to the filesystem root would import the user's home-directory
  // `.gitignore` into a project that never asked for it.
  for (let depth = 0; depth < 32; depth++) {
    try {
      patterns.push(readFileSync(`${current}${sep}.gitignore`, 'utf8'))
    } catch {
      // No rules at this level — keep walking.
    }
    if (existsSync(`${current}${sep}.git`)) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  if (!patterns.length) return null
  return ignore().add(patterns.join('\n'))
}
