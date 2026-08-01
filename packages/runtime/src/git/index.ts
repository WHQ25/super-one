/**
 * @superone/runtime/git — pure git helpers + process runner (no Electron).
 */

export { sanitizeGitRef, gitErrorMessage } from './sanitize-ref'
export { parseShortstat } from './shortstat'
export {
  parseWorktreePorcelain,
  type WorktreePorcelainEntry,
} from './worktree-porcelain'
export { gitRun, gitRunSync, type GitRunOptions } from './run'
export {
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
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
  type GitStatusPair,
  type ParsedGitStatusLine,
  type ParsedGitStatus,
  type ParsedGitStatusFile,
} from './status-utils'
