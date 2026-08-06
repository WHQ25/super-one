/**
 * Node harness resource discovery RPC contracts (harness.resources / harness.connect).
 *
 * Aggregates models, skills, commands, agents, codex prompts, and optional
 * account probe so remote projects do not depend on desktop CONNECT_* caches.
 */

import type {
  AccountInfo,
  AgentInfo,
  ModelOption,
  SlashCommandInfo,
} from '../agent-types'

export interface HarnessResourcesClaudeWire {
  models: ModelOption[]
  account: AccountInfo
  slashCommands: SlashCommandInfo[]
  skills: SlashCommandInfo[]
  commands: SlashCommandInfo[]
  agents: AgentInfo[]
  outputStyles: string[]
}

export interface HarnessResourcesCodexWire {
  models: ModelOption[]
  prompts: SlashCommandInfo[]
}

export interface HarnessResourcesOpenCodeWire {
  models: ModelOption[]
  agents: Array<{ id: string; name: string; description?: string; modelId?: string | null }>
  commands: SlashCommandInfo[]
}

export interface HarnessResourcesAcpWire {
  agents: Array<{ id: string; name: string; installed: boolean; commandPreview: string }>
}

export interface HarnessResourcesRequest {
  /**
   * Node project id. Required so skills/commands/agents resolve against the
   * project root on the node (not the desktop path).
   */
  projectId: string
  /** When set, only that harness section is filled. */
  harnessId?: string
  /** Optional API provider credential id for model catalog resolution. */
  apiProviderId?: string | null
}

export interface HarnessResourcesResult {
  claude: HarnessResourcesClaudeWire
  codex: HarnessResourcesCodexWire
  opencode: HarnessResourcesOpenCodeWire
  acp: HarnessResourcesAcpWire
}
