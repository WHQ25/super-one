/** Branches matching the search box, in their listed order. */
export function filterBranches(branches: readonly string[], query: string): string[] {
  const search = query.trim().toLowerCase()
  if (!search) return [...branches]
  return branches.filter((branch) => branch.toLowerCase().includes(search))
}

/**
 * The branch the search box offers to create: a non-empty query that no
 * existing branch already spells, compared case-insensitively because git
 * refs collide that way on macOS and Windows checkouts.
 */
export function branchToCreate(branches: readonly string[], query: string): string | null {
  const name = query.trim()
  if (!name) return null
  const lower = name.toLowerCase()
  return branches.some((branch) => branch.toLowerCase() === lower) ? null : name
}
