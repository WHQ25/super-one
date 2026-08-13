/**
 * Shared local-agent options for Agent.create and official workspace prewarm.
 * Executor cache keys on cwd / apiKey / settingSources / sandbox / MCP /
 * autoReview — these must match or the first send still pays the workspace cost.
 */

import type { AgentOptions, McpServerConfig, SettingSource } from '@cursor/sdk'
import type { PermissionMode } from '@superone/shared/agent-types'
import {
  mapPermissionToCursorLocal,
  readCursorConfig,
  resolveCursorApiKeyPlain,
  type CursorConfig,
} from './cursor-config'
import { resolveCursorSandboxEnabled } from './cursor-platform-binaries'
import { stripStdioCwd } from './cursor-mcp-map'

export const DEFAULT_CURSOR_SETTING_SOURCES: SettingSource[] = ['project', 'user']

export interface CursorLocalSessionPlan {
  apiKey: string | undefined
  config: CursorConfig
  isCloud: boolean
  settingSources: SettingSource[]
  sandboxEnabled: boolean
  sandboxRequested: boolean
  perm: { mode: 'agent' | 'plan'; autoReview: boolean }
  enableAgentRetries: boolean
  mcpServers: Record<string, McpServerConfig>
}

export function resolveCursorLocalSessionPlan(input: {
  cwd: string
  sessionId: string
  config: unknown
  permissionMode: PermissionMode
  sandboxEnabled?: boolean
  providerSessionId?: string
  resolveApiKey?: (config: unknown) => string | undefined
  buildMcpServers?: (cwd: string, sessionId: string) => Record<string, McpServerConfig>
}): CursorLocalSessionPlan {
  const config = readCursorConfig(input.config)
  const resolveApiKey = input.resolveApiKey ?? resolveCursorApiKeyPlain
  const buildMcpServers = input.buildMcpServers ?? (() => ({}))
  const isCloud = config.runtime === 'cloud'
    || (input.providerSessionId?.startsWith('bc-') ?? false)
  const perm = mapPermissionToCursorLocal(input.permissionMode)
  const settingSources = config.settingSources ?? DEFAULT_CURSOR_SETTING_SOURCES
  const sandboxRequested = input.sandboxEnabled ?? config.sandboxEnabled ?? false
  const sandboxEnabled = isCloud ? false : resolveCursorSandboxEnabled(sandboxRequested)
  const mcpServers = isCloud
    ? stripStdioCwd(buildMcpServers(input.cwd, input.sessionId))
    : buildMcpServers(input.cwd, input.sessionId)
  return {
    apiKey: resolveApiKey(input.config),
    config,
    isCloud,
    settingSources,
    sandboxEnabled,
    sandboxRequested,
    perm,
    enableAgentRetries: config.enableAgentRetries ?? true,
    mcpServers,
  }
}

/** AgentOptions that must match Agent.create so prewarm hits the executor cache. */
export function buildCursorWorkspaceAgentOptions(
  cwd: string,
  plan: CursorLocalSessionPlan,
): AgentOptions {
  return {
    apiKey: plan.apiKey,
    mcpServers: plan.mcpServers,
    mode: plan.perm.mode,
    local: {
      cwd,
      settingSources: plan.settingSources,
      sandboxOptions: { enabled: plan.sandboxEnabled },
      autoReview: plan.perm.autoReview,
      enableAgentRetries: plan.enableAgentRetries,
    },
  }
}

export function cursorWorkspacePrewarmKey(cwd: string, plan: CursorLocalSessionPlan): string {
  return JSON.stringify({
    cwd,
    settingSources: plan.settingSources,
    sandboxEnabled: plan.sandboxEnabled,
    autoReview: plan.perm.autoReview,
    enableAgentRetries: plan.enableAgentRetries,
    mcpServers: plan.mcpServers,
  })
}
