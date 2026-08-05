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
  listManagedSkills,
  getManagedSkill,
  readManagedSkillFile,
  deleteManagedSkill,
  installManagedSkill,
  getSkillDirs,
  getClaudeSkillDirs,
  getCodexSkillDirs,
  type SkillDir,
  type SkillsManageOptions,
} from './skills-manage'
export {
  listMcpConfigs,
  saveMcpConfig,
  toggleMcpConfig,
  deleteMcpConfig,
  listClaudeMcpConfigs,
  saveClaudeMcpConfig,
  toggleClaudeMcpConfig,
  deleteClaudeMcpConfig,
  listCodexMcpConfigs,
  saveCodexMcpConfig,
  toggleCodexMcpConfig,
  deleteCodexMcpConfig,
  type McpManageOptions,
  type McpWriteFields,
} from './mcp-config'
export {
  EXCLUDED_DIRS,
  fuzzyMatch,
  searchMentionsInEntries,
  searchFilesInEntries,
  type AgentEntry,
  type FuzzyMatchResult,
} from './fuzzy'
