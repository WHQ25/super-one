/**
 * @superone/runtime/fs — pure workspace path security + file inventory.
 */

export {
  resolveProjectPath,
  assertInsideRoot,
  pathKind,
  resolveRealPath,
  isPathWithinAllowed,
  isPathAtOrWithinAllowed,
  getReadableAssetRoots,
} from './path-security'
export {
  listFilesUnderRoot,
  LIST_FILES_EXCLUDED,
  MAX_LIST_FILES,
  DEFAULT_LIST_DEPTH,
  type WorkspaceFileEntry,
} from './list-files'
export {
  discoverClaudeSkillsAndCommands,
  parseSimpleFrontmatter,
  type ClaudeSkillInfo,
} from './skills-discover'
export {
  EXCLUDED_DIRS,
  fuzzyMatch,
  searchMentionsInEntries,
  searchFilesInEntries,
  type AgentEntry,
  type FuzzyMatchResult,
} from './fuzzy'
