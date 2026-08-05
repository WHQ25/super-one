/**
 * Unified MCP config facade for Claude + Codex (node resource RPC).
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

export type McpManageOptions = ClaudeMcpOptions & CodexMcpOptions

export type McpWriteFields = Partial<
  Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>
>

export function listMcpConfigs(
  provider: ResourceProvider,
  cwd: string,
  opts?: McpManageOptions,
): McpServerConfig[] {
  return provider === 'codex' ? listCodexMcpConfigs(cwd, opts) : listClaudeMcpConfigs(cwd, opts)
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
  listCodexMcpConfigs,
  saveCodexMcpConfig,
  toggleCodexMcpConfig,
  deleteCodexMcpConfig,
} from './mcp-config-codex'
