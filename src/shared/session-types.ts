import type { AgentEvent, ChatMessage, PermissionMode, SandboxInfo } from './agent-types'

export type HarnessId = 'claude' | 'codex'

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
  readonly messages: ReadonlyArray<ChatMessage>
  readonly totalCostUsd: number
  readonly contextTokens: number
  readonly title: string | null
  readonly isWorktree: boolean
  readonly worktreePath: string | null
  readonly gitBranch: string | null
  readonly worktreeMissing: boolean
}

export interface LiveSessionSnapshot {
  sid: string
  projectPath: string
  isActive: boolean
  isStreaming: boolean
  permissionMode: PermissionMode
  sandboxInfo: SandboxInfo
  snapshot: SessionSnapshot
  pendingInteractions: AgentEvent[]
  replayEvents: AgentEvent[]
}
