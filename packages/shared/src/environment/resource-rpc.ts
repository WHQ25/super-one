/**
 * Node resource management RPC contracts (skills + MCP).
 *
 * Electron-free. Desktop can call these against a remote environment;
 * local desktop still uses in-process services. Shapes match
 * `@superone/shared/agent-types` SkillInfo / McpServerConfig for UI reuse.
 */

import type {
  McpServerConfig,
  ResourceScope,
  SkillDetail,
  SkillInfo,
} from '../agent-types'

/** Provider surface that owns skill roots / MCP config files. */
export type ResourceProvider = 'claude' | 'codex'

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
