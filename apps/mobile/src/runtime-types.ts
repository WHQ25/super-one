import type { AgentEvent, HarnessId, ImageAttachment, RemoteSystemInfo } from '@superone/shared/agent-types'
import type { CachedTranscript } from '@superone/relay-client'

export type SessionTranscriptCache = {
  get(pairingId: string, projectPath: string, sessionId: string): CachedTranscript | null
  put(pairingId: string, projectPath: string, sessionId: string, transcript: CachedTranscript): void
}

export type ChatRuntimeHooks = {
  onCommandError?(message: string): void
  onComposerResult?: (result: import('./widget-composer-client').WidgetComposerResult) => void
  onCachedHydrate?: () => void
  onDetail?: (event: Extract<AgentEvent, { type: 'remote_detail' }>) => void
  onSessionRecap?: (sessionId: string) => void
  transcripts?: SessionTranscriptCache
  pairingId?: () => string | null
}

export type SystemInfo = RemoteSystemInfo

/** The worktree half of the restore snapshot, kept together so it updates atomically. */
export type SessionWorktreeFacts = {
  isWorktree: boolean
  worktreePath: string | null
  /** Branch recorded at creation; for a worktree session, the worktree's own. */
  gitBranch: string | null
}

export type CreateSessionOptions = {
  draftId?: string
  draftLeaseId?: string
  sandboxMode?: import('@superone/shared/agent-types').SandboxMode
  /** Client-chosen id so the shell can leave the landing before the host answers. */
  sessionId?: string
  provider?: HarnessId
  acpAgentId?: string
  permissionMode?: string
  effort?: string
  model?: string
  gitBranch?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeMode?: 'branch' | 'attach' | 'detach'
  worktreeBranchName?: string
  worktreeCarryLocalChanges?: boolean
  additionalDirectories?: string[]
  /** ACP session mode picked on the draft. */
  mode?: string
  /** DeepSeek preset picked on the draft. */
  agentPreset?: string
  /** Credential the draft resolved to; `null` is the host default. */
  apiProviderId?: string | null
}

export type SendMessageOptions = {
  collaborationMode?: string
  images?: ImageAttachment[]; model?: string; effort?: string
  /** OpenCode primary agent for this turn. */
  agent?: string | null
  /** Codex Fast service tier. */
  serviceTier?: string | null
  /** Cursor catalog params (param id → value). */
  modelParams?: Record<string, string>
  /** Claude Ultracode toggle; omitted keeps the session's. */
  ultracode?: boolean
  clientMessageId?: string
  inputRequest?: import('@superone/shared/input-request').InputRequestSubmission
  priority?: 'now' | 'next' | 'later'
  /** Park then steer in one host command — composer Stair. */
  steer?: 'now' | 'next'
}
