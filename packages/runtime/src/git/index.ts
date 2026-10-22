/**
 * @superone/runtime/git — pure git helpers + process runner (no Electron).
 */

export { sanitizeGitRef, gitErrorMessage, isNotGitRepoError } from './sanitize-ref'
export { parseShortstat } from './shortstat'
export {
  parseWorktreePorcelain,
  type WorktreePorcelainEntry,
} from './worktree-porcelain'
export { gitRun, type GitRunOptions } from './run'
export { withRepoLock } from './repo-lock'
export {
  GIT_READ_OPTS,
  worktreeGit,
  samePath,
  resolveMainWorktreeDir,
  carryUncommittedChanges,
  activateWorktree,
  handoffPreview,
  handoffToMain,
  assignBranch,
  type WorktreeGit,
  type ActivateWorktreeInput,
  type ActivateWorktreeResult,
  type AssignBranchResult,
  type HandoffResult,
  type HandoffPreview,
} from './worktree-ops'
export { fetchRemoteCommands, isGitRemoteName } from './fetch'
export { checkoutExistingBranch, localBranchList, localBranchNames, readLocalBranchNames } from './branch-refs'
export type { LocalBranchList } from './branch-refs'
export {
  filterRankGitMentionRefs,
  gitMentionRefsFailure,
  listGitMentionRefs,
  probeGitMentionCapabilities,
  rankGitMentionRefs,
  scanGitMentionRefs,
  type GitMentionRunner,
  type GitMentionRunners,
  type GitMentionScanKind,
} from './mention-refs'
export { ghRun, isGhMissingError } from './gh-run'
export {
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
  allocateWorktreePath,
  worktreeAddArgs,
  recordedBranchForMode,
  parseNumstat,
  worktreeInfoFromPorcelain,
  checkedOutBranchesFromPorcelain,
} from './worktree-plan'
export {
  parseGitStatusLine,
  parseGitStatusOutput,
  parseGitStatusFiles,
  normalizeGitPath,
  resolveEntryStatusPair,
  dirStatusPair,
  worstChildPair,
  isPairIgnored,
  isUnderDirSet,
  IGNORED_PAIR,
  UNTRACKED_PAIR,
  EMPTY_PAIR,
  GIT_STATUS_PRIORITY,
  GIT_TREE_STATUS_ARGS,
  type GitStatusPair,
  type ParsedGitStatusLine,
  type ParsedGitStatus,
  type ParsedGitStatusFile,
} from './status-utils'
