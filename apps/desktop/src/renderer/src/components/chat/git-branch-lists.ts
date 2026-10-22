import { localBranchList, type LocalBranchList } from '@superone/runtime/git/branch-refs'

export type GitBranchLists = LocalBranchList

export const EMPTY_BRANCH_LISTS: GitBranchLists = { local: [] }

/** A legacy `string[]` is local branches only. An `error` is not an empty list. */
export function readBranchLists(value: unknown): GitBranchLists {
  return localBranchList(value)
}
