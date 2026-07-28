import type {
  AgentEvent,
  ChatMessage,
  HarnessId,
  PermissionMode,
  SandboxInfo,
  SessionSettingsPatch,
} from './agent-types'

export type { HarnessId }

export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'interrupting'
  | 'ended'
  | 'disposed'

export interface SessionSnapshot {
  readonly id: string
  readonly projectPath: string
  readonly cwd: string
  readonly providerId: string
  readonly harnessId: HarnessId
  readonly status: SessionStatus
  readonly providerSessionId: string | null
  readonly currentMessageId: string | null
  readonly createdAt: number
  readonly lastUserMessageAt: number | null
  readonly lastEventAt: number
  readonly messages: ReadonlyArray<ChatMessage>
  readonly totalCostUsd: number
  readonly contextTokens: number
  readonly title: string | null
  readonly isWorktree: boolean
  readonly worktreePath: string | null
  readonly gitBranch: string | null
  readonly worktreeMissing: boolean
  readonly apiProviderId: string | null
  /** ACP agent id when harnessId is `acp` (e.g. `grok-build`). Required so mini-window live sync can brand correctly. */
  readonly acpAgentId: string | null
  /** Active model id (Claude/Codex/ACP/OpenCode). Mini-window live sync needs this before acp_models replay. */
  readonly selectedModel: string | null
  readonly selectedEffort: string | null
}

/**
 * Composer / status-bar UI state carried on every live snapshot so mini-window
 * (and any late subscriber) paints the same controls as the main window.
 * Includes permission mode, sandbox, model/effort, codex presets, OpenCode agent, etc.
 */
export type SessionUiSettings = SessionSettingsPatch

export interface LiveSessionSnapshot {
  sid: string
  projectPath: string
  isActive: boolean
  isStreaming: boolean
  permissionMode: PermissionMode
  sandboxInfo: SandboxInfo
  /** Accumulated UI settings for multi-window live sync. */
  uiSettings: SessionUiSettings
  snapshot: SessionSnapshot
  pendingInteractions: AgentEvent[]
  replayEvents: AgentEvent[]
}
