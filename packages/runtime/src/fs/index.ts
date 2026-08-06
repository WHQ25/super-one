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
  TOOL_OUTPUT_REL_PREFIX,
  normalizeProjectRelativePath,
  isToolOutputRelativePath,
  toProjectRelativePath,
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
  ensureMcpMerge,
  resolveMcpMergeMode,
  toClaudeSdkMcpEntry,
  toCodexThreadMcpEntry,
  HOST_ACTION_MCP_NAME,
  type McpMergeMode,
  type EnsureMcpMergeOptions,
  type EnsureMcpMergeResult,
  type ClaudeSdkMcpEntry,
  type CodexThreadMcpEntry,
} from './mcp-merge'
export {
  EXCLUDED_DIRS,
  fuzzyMatch,
  searchMentionsInEntries,
  searchFilesInEntries,
  type AgentEntry,
  type FuzzyMatchResult,
} from './fuzzy'
export {
  listPlugins,
  readPluginContent,
  readPluginFile,
  deletePlugin,
  listMarketplacePlugins,
  installPlugin,
  updatePlugin,
  updateMarketplace,
  addMarketplace,
  removeMarketplace,
  readMarketplacePluginContent,
  readMarketplacePluginFile,
  type PluginsManageOptions,
} from './plugins-manage'
export {
  listHooks,
  saveHook,
  deleteHook,
  type HooksConfigOptions,
} from './hooks-config'
export {
  discoverUserAgents,
  discoverProjectAgents,
  discoverAllAgents,
  readAgentFile,
  type AgentsDiscoverOptions,
} from './agents-discover'
