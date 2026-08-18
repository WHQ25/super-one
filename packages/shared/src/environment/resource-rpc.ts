/**
 * Node resource management RPC contracts (skills + MCP + plugins + agents + hooks).
 *
 * Electron-free. Desktop can call these against a remote environment;
 * local desktop still uses in-process services. Shapes match
 * `@superone/shared/agent-types` for UI reuse.
 */

import type {
  AgentInfo,
  HookConfig,
  HookSavePayload,
  MarketplacePlugin,
  MarketplacePluginDetail,
  MarketplaceScope,
  McpServerConfig,
  PluginDetail,
  PluginInfo,
  ResourceScope,
  SkillDetail,
  SkillInfo,
} from '../agent-types'

/**
 * Harness whose own config files a resource request targets. SuperOne extends
 * each harness rather than centralizing its config, so this names the owner of
 * the file being read or written — `dsh` reaches its profile patch layer, and
 * only for MCP: it has no skills surface here.
 */
export type ResourceProvider = 'claude' | 'codex' | 'dsh'

// --- Skills ---

export interface SkillsListRequest {
  projectId: string
  /** Default: claude */
  provider?: ResourceProvider
}

export interface SkillsListResult {
  skills: SkillInfo[]
  provider: ResourceProvider
}

export interface SkillsGetRequest {
  projectId: string
  name: string
  /** Disambiguate same-named skills in different roots. */
  sourcePath?: string
  provider?: ResourceProvider
}

export interface SkillsGetResult {
  skill: SkillDetail | null
  provider: ResourceProvider
}

export interface SkillsReadFileRequest {
  projectId: string
  skillName: string
  relativePath: string
  sourcePath?: string
  provider?: ResourceProvider
}

export interface SkillsReadFileResult {
  content: string
  provider: ResourceProvider
}

export interface SkillsDeleteRequest {
  projectId: string
  /** Absolute path from SkillInfo.sourcePath on the node. */
  sourcePath: string
  provider?: ResourceProvider
}

export interface SkillsDeleteResult {
  ok: true
  provider: ResourceProvider
}

/**
 * Install a skill by writing files under the provider skill root.
 * Remote clients upload content (no host-local source path).
 */
export interface SkillsInstallRequest {
  projectId: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  /** Skill directory name (not a path). */
  name: string
  /**
   * Relative path → UTF-8 content. Must include `SKILL.md`.
   * Paths may not escape the skill directory.
   */
  files: Record<string, string>
  provider?: ResourceProvider
}

export interface SkillsInstallResult {
  skill: SkillInfo
  provider: ResourceProvider
}

// --- MCP ---

export interface McpListRequest {
  projectId: string
  provider: ResourceProvider
}

export interface McpListResult {
  servers: McpServerConfig[]
  provider: ResourceProvider
}

export type McpServerWriteFields = Partial<
  Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>
>

export interface McpSaveRequest {
  projectId: string
  provider: ResourceProvider
  name: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  config: McpServerWriteFields
}

export interface McpSaveResult {
  ok: true
  provider: ResourceProvider
}

export interface McpToggleRequest {
  projectId: string
  provider: ResourceProvider
  name: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  disabled: boolean
}

export interface McpToggleResult {
  ok: true
  provider: ResourceProvider
}

export interface McpDeleteRequest {
  projectId: string
  provider: ResourceProvider
  name: string
  scope: Extract<ResourceScope, 'user' | 'project'>
}

export interface McpDeleteResult {
  ok: true
  provider: ResourceProvider
}

// --- Claude plugins ---

export interface PluginsListRequest {
  projectId: string
  /** Default / only supported: claude */
  provider?: ResourceProvider
}

export interface PluginsListResult {
  plugins: PluginInfo[]
  provider: ResourceProvider
}

export interface PluginsGetRequest {
  projectId: string
  key: string
  provider?: ResourceProvider
}

export interface PluginsGetResult {
  plugin: PluginDetail | null
  provider: ResourceProvider
}

export interface PluginsReadFileRequest {
  projectId: string
  pluginKey: string
  relativePath: string
  provider?: ResourceProvider
}

export interface PluginsReadFileResult {
  content: string
  provider: ResourceProvider
}

export interface PluginsDeleteRequest {
  projectId: string
  key: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  provider?: ResourceProvider
}

export interface PluginsDeleteResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsInstallRequest {
  projectId: string
  key: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  provider?: ResourceProvider
}

export interface PluginsInstallResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsUpdateRequest {
  projectId: string
  key: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  provider?: ResourceProvider
}

export interface PluginsUpdateResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsListMarketplaceRequest {
  projectId: string
  provider?: ResourceProvider
}

export interface PluginsListMarketplaceResult {
  plugins: MarketplacePlugin[]
  provider: ResourceProvider
}

export interface PluginsAddMarketplaceRequest {
  projectId: string
  source: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  provider?: ResourceProvider
}

export interface PluginsAddMarketplaceResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsRemoveMarketplaceRequest {
  projectId: string
  name: string
  scope: MarketplaceScope
  provider?: ResourceProvider
}

export interface PluginsRemoveMarketplaceResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsUpdateMarketplaceRequest {
  projectId: string
  name: string
  provider?: ResourceProvider
}

export interface PluginsUpdateMarketplaceResult {
  ok: true
  provider: ResourceProvider
}

export interface PluginsReadMarketplaceRequest {
  projectId: string
  marketplace: string
  name: string
  provider?: ResourceProvider
}

export interface PluginsReadMarketplaceResult {
  plugin: MarketplacePluginDetail | null
  provider: ResourceProvider
}

export interface PluginsReadMarketplaceFileRequest {
  projectId: string
  marketplace: string
  name: string
  relativePath: string
  provider?: ResourceProvider
}

export interface PluginsReadMarketplaceFileResult {
  content: string
  provider: ResourceProvider
}

// --- Agents catalog ---

export interface AgentsListRequest {
  projectId: string
}

export interface AgentsListResult {
  agents: Array<AgentInfo & { scope: 'user' | 'project' }>
}

export interface AgentsReadFileRequest {
  projectId: string
  name: string
}

export interface AgentsReadFileResult {
  content: string | null
}

// --- Hooks (settings.json#hooks) ---

export interface HooksListRequest {
  projectId: string
}

export interface HooksListResult {
  hooks: HookConfig[]
}

export interface HooksSaveRequest {
  projectId: string
  payload: HookSavePayload
  replaceId?: string
}

export interface HooksSaveResult {
  ok: true
}

export interface HooksDeleteRequest {
  projectId: string
  id: string
}

export interface HooksDeleteResult {
  ok: true
}
