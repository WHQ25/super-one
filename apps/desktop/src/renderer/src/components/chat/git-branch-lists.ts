import { trackingCheckoutPlan, type GitBranchLists } from '@superone/runtime/git/branch-refs'

export type { GitBranchLists }
export { trackingCheckoutPlan }

export const EMPTY_BRANCH_LISTS: GitBranchLists = { local: [], tracking: [] }

/** A legacy `string[]` is local branches only. */
export function readBranchLists(value: unknown): GitBranchLists {
  if (Array.isArray(value)) {
    return { local: value.filter((item): item is string => typeof item === 'string'), tracking: [] }
  }
  if (!value || typeof value !== 'object') return EMPTY_BRANCH_LISTS
  const record = value as { local?: unknown; tracking?: unknown }
  const names = (list: unknown) => Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string')
    : []
  return { local: names(record.local), tracking: names(record.tracking) }
}
