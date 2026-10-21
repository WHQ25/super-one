/** Local branch names and remote-tracking refs for one checkout. */
export interface GitBranchLists {
  local: string[]
  tracking: string[]
}

export function localBranchNames(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean)
}

/**
 * `git for-each-ref --format=%(refname:strip=2) refs/remotes`.
 * Drops the symbolic `HEAD` ref (`origin` and `origin/HEAD`).
 */
export function trackingRefNames(raw: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const line of raw.split('\n')) {
    const name = line.trim()
    // `origin` is the remote's symbolic HEAD, not a branch. `origin/HEAD` is the same ref.
    if (!name || !name.includes('/') || name.endsWith('/HEAD') || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Checking out `origin/x` must become local branch `x`.
 * `track` is set only when that local branch does not exist yet.
 * The returned branch is never the remote-tracking ref itself.
 */
export function trackingCheckoutPlan(
  ref: string,
  localBranches: readonly string[],
): { branch: string; track: string | null } | null {
  const slash = ref.indexOf('/')
  if (slash <= 0 || slash === ref.length - 1) return null
  const branch = ref.slice(slash + 1)
  if (!branch || branch === 'HEAD' || branch.endsWith('/HEAD')) return null
  const exists = localBranches.includes(branch)
  return { branch, track: exists ? null : ref }
}
