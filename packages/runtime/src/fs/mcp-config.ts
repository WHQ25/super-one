/**
 * Unified MCP config facade (node resource RPC).
 *
 * Each harness keeps its servers in its own file — SuperOne extends a harness
 * rather than centralizing it — so this only routes to the right owner:
 * Codex's `config.toml`, dsh's profile patch layer, Claude's `.mcp.json` family
 * for the harnesses that read it.
 */

import type { McpServerConfig, ResourceScope } from '@superone/shared/agent-types'
import type { ResourceProvider } from '@superone/shared/environment'
import {
  deleteClaudeMcpConfig,
  listClaudeMcpConfigs,
  saveClaudeMcpConfig,
  toggleClaudeMcpConfig,
  type ClaudeMcpOptions,
} from './mcp-config-claude'
import {
  deleteCodexMcpConfig,
  listCodexMcpConfigs,
  saveCodexMcpConfig,
  toggleCodexMcpConfig,
  type CodexMcpOptions,
} from './mcp-config-codex'
import {
  deleteDshMcpConfig,
  listDshMcpConfigs,
  saveDshMcpConfig,
  toggleDshMcpConfig,
  type DshMcpOptions,
} from './mcp-config-dsh'

export type McpManageOptions = ClaudeMcpOptions & CodexMcpOptions & DshMcpOptions

export type McpWriteFields = Partial<
  Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>
>

export function listMcpConfigs(
  provider: ResourceProvider,
  cwd: string,
  opts?: McpManageOptions,
): McpServerConfig[] {
  if (provider === 'codex') return listCodexMcpConfigs(cwd, opts)
  if (provider === 'dsh') return listDshMcpConfigs(cwd, opts)
  return listClaudeMcpConfigs(cwd, opts)
}

export function saveMcpConfig(
  provider: ResourceProvider,
  name: string,
  config: McpWriteFields,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: McpManageOptions,
): void {
  if (provider === 'codex') {
    saveCodexMcpConfig(name, config, scope, cwd, opts)
  } else if (provider === 'dsh') {
    saveDshMcpConfig(name, config, scope, cwd, opts)
  } else {
    saveClaudeMcpConfig(name, config, scope, cwd, opts)
  }
}

export function toggleMcpConfig(
  provider: ResourceProvider,
  name: string,
  disabled: boolean,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: McpManageOptions,
): void {
  if (provider === 'codex') {
    toggleCodexMcpConfig(name, disabled, scope, cwd, opts)
  } else if (provider === 'dsh') {
    toggleDshMcpConfig(name, disabled, scope, cwd, opts)
  } else {
    toggleClaudeMcpConfig(name, disabled, scope, cwd, opts)
  }
}

export function deleteMcpConfig(
  provider: ResourceProvider,
  name: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: McpManageOptions,
): void {
  if (provider === 'codex') {
    deleteCodexMcpConfig(name, scope, cwd, opts)
  } else if (provider === 'dsh') {
    deleteDshMcpConfig(name, scope, cwd, opts)
  } else {
    deleteClaudeMcpConfig(name, scope, cwd, opts)
  }
}

export {
  listClaudeMcpConfigs,
  saveClaudeMcpConfig,
  toggleClaudeMcpConfig,
  deleteClaudeMcpConfig,
} from './mcp-config-claude'
export {
  listDshMcpConfigs,
  saveDshMcpConfig,
  toggleDshMcpConfig,
  deleteDshMcpConfig,
  getDshPatchPath,
} from './mcp-config-dsh'
export {
  listCodexMcpConfigs,
  saveCodexMcpConfig,
  toggleCodexMcpConfig,
  deleteCodexMcpConfig,
} from './mcp-config-codex'
