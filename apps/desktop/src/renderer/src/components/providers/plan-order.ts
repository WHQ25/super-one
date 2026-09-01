import type { Credential, Plan, Platform } from '@superone/shared/platform-registry'

/**
 * Plans ordered by how many keys the user has stored under each, most keys first.
 *
 * The registry lists plans in editorial order (`cn` before `global` for the Chinese vendors), which
 * is the right default for a platform nobody has configured yet — but wrong once the user has keys
 * on only one of them: they would have to re-pick that plan on every visit. Key count is the
 * cheapest available signal of which plan the user actually uses.
 *
 * Ties keep registry order (`Array#sort` is stable), so an unconfigured platform is untouched.
 */
export function plansByKeyCount(platform: Platform, credentials: Credential[]): Plan[] {
  const counts = new Map<string, number>()
  for (const c of credentials) {
    if (c.platformId !== platform.id) continue
    counts.set(c.planId, (counts.get(c.planId) ?? 0) + 1)
  }
  if (counts.size === 0) return platform.plans
  return [...platform.plans].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
}
