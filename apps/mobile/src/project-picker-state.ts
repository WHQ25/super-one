import { fuzzyMatch } from './slash'

/**
 * Rank the open projects against what was typed, dropping the misses.
 *
 * Selecting a project and adding one are separate screens, so this is the whole
 * of the picker's logic: the same fuzzy ranking the rest of the shell uses.
 */
export function filterProjects<T extends { name: string }>(
  projects: readonly T[],
  query: string,
): T[] {
  const filter = query.trim().toLowerCase()
  if (!filter) return [...projects]
  return projects
    .map((project) => ({ project, match: fuzzyMatch(filter, project.name) }))
    .filter(({ match }) => match.match)
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ project }) => project)
}
