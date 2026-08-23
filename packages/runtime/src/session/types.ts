import type { SessionTurnEvent } from '@superone/shared/environment'
import type { AgentEvent } from '@superone/shared/agent-types'

export type SessionStatus =
  | 'idle'
  | 'streaming'
  | 'interrupted'
  | 'error'
  | 'unknown'
  | 'ended'

/**
 * Durable per-session turn defaults. Written by `session.patchSettings` and
 * applied as `session.send` fallbacks when the turn payload omits a key.
 * All fields optional on the wire; null clears a stored default.
 */
export interface NodeSessionSettings {
  permissionMode?: string | null
  sandboxMode?: string | null
  model?: string | null
  effort?: string | null
  apiProviderId?: string | null
}

export interface NodeSessionRecord {
  sessionId: string
  projectId: string
  harnessId: string
  providerId: string
  title: string | null
  status: SessionStatus
  transcript: TranscriptBlock[]
  pendingInteraction: PendingInteraction | null
  providerResume: string | null
  /**
   * Absolute host cwd for agent turns (project root or git worktree).
   * Null = use project registry path.
   */
  cwd: string | null
  /**
   * Durable turn defaults (permissionMode, sandboxMode, model, effort, apiProviderId).
   * Null / undefined means "no stored default" — send must supply the value or harness uses its own.
   * Always written by SessionRuntime.create / patchSettings / load path.
   */
  permissionMode?: string | null
  sandboxMode?: string | null
  model?: string | null
  effort?: string | null
  apiProviderId?: string | null
  createdAt: number
  updatedAt: number
  isPinned: boolean
  isHidden: boolean
  /**
   * True after a user (sidebar) rename. Agent renames are rejected while set —
   * desktop parity with sessions.is_user_renamed / session_rename user_locked.
   */
  isUserRenamed: boolean
  /** Agent-set labels for archive list/search. Empty / omitted when unset. */
  tags?: string[]
  /** Once set, runTurn finalizers must not overwrite closed/ended state. */
  closed?: boolean
  /**
   * Pairing-level controller identity (clientSessionId) that may poll/claim/respond
   * host actions for this session. Bound at create; handoff is deliberately deferred
   * (fail closed — a different paired desktop is rejected).
   */
  controllerClientSessionId: string | null
  /** Capability version for the Host Action channel (0 = unbound / unsupported). */
  hostActionCapabilityVersion: number
  /** Session-scoped tool groups the controller may execute (e.g. browser.read). */
  hostActionToolGroups: string[]
  /**
   * Tool names auto-allowed for the rest of this session after the user
   * chose allow_always (desktop permission-mode parity, session-scoped).
   */
  alwaysAllowedTools: string[]
  /**
   * True when this session was spawned by an automation (filterable in list metadata).
   */
  isAutomation?: boolean
  /** Owning automation id when isAutomation is true. */
  automationId?: string | null
}

/** Image/document attachment for a remote turn (base64 payload). */
export interface TurnImageAttachment {
  name?: string
  mimeType: string
  base64: string
}

export interface TranscriptBlock {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
}

export interface PendingInteraction {
  interactionId: string
  kind: 'permission' | 'question' | 'plan' | 'session_agents_confirm'
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
  createdAt: number
  /**
   * Multi-launch confirm payload when kind === 'session_agents_confirm'.
   * Desktop remote UI maps this onto PermissionRequest.sessionAgentsConfirm.
   */
  sessionAgentsConfirm?: {
    launches: unknown[]
    profiles: unknown[]
  }
  /** Rich permission requestKind for desktop UI (e.g. session_agents_confirm). */
  requestKind?: string
  message?: string
  serverName?: string
  allowAlwaysAllow?: boolean
}

/** Outcome of session_collab_request multi-launch user confirmation. */
export type AgentsConfirmOutcome = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type PermissionDecision = 'allow' | 'deny'

/** Answers map for ask-user-question interactions. */
export type QuestionAnswers = unknown

export type PlanDecisionResult = {
  decision: 'approve' | 'reject'
  options?: Record<string, unknown>
}

/** Default wall-clock wait for a human permission/question/plan response (ms). */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000

/**
 * Injectable turn runner for harness adapters (Claude, Codex, ACP, OpenCode).
 *
 * Optional lifecycle hooks let long-lived harness processes (ClaudeLiveSession)
 * release SDK children and host-action MCP when a session ends or the runtime
 * shuts down. Simple FIFO runners may omit them.
 */
export interface ActiveHarnessRuntime {
  sessionId: string
  lastActivityAt: number
  /** Includes an in-flight turn, queued turn, or pending interaction. */
  busy: boolean
}

export type TurnRunner = ((input: {
  session: NodeSessionRecord
  /** Stable assistant message id allocated by SessionRuntime for this turn. */
  messageId?: string
  text: string
  model?: string | null
  /** Reasoning / thinking effort (Claude effort or Codex reasoningEffort). */
  effort?: string | null
  /** Inline images/docs for this turn (host already validated size). */
  images?: TurnImageAttachment[]
  /**
   * Permission mode for this turn (Claude SDK permissionMode / desktop parity).
   * e.g. default | acceptEdits | bypassPermissions | plan | dontAsk | auto
   */
  permissionMode?: string | null
  /**
   * Sandbox / filesystem policy for this turn (Codex sandboxMode / Claude
   * Agent SDK `sandbox`: `off` | `on` | `auto`).
   */
  sandboxMode?: string | null
  /** Extra readable directories (Claude additionalDirectories). */
  additionalDirectories?: string[]
  /**
   * Explicit skill allow-list for Claude SDK `skills` option (desktop parity when
   * the user has disabled skills). When omitted, SDK discovers via settingSources.
   */
  enabledSkills?: string[]
  /**
   * Skills to exclude. Node may compute enabledSkills from discovery − disabled
   * when enabledSkills is not provided.
   */
  disabledSkills?: string[]
  /** Node provider credential id for this turn (API key source). */
  apiProviderId?: string | null
  /**
   * Codex turn kind (run|steer|review|compact). Omitted = run.
   * steer injects into an in-flight app-server turn on a long-lived connection.
   */
  turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
  /** Codex collaboration mode (string mode name or app-server object). */
  collaborationMode?: string | Record<string, unknown> | null
  /** Codex review/start target payload. */
  reviewTarget?: unknown
  onDelta: (text: string) => void
  onEvent?: (event: SessionTurnEvent) => void
  /** Lossless harness-native AgentEvent stream. */
  onAgentEvent?: (event: AgentEvent) => void
  onPermission?: (interaction: PendingInteraction) => Promise<PermissionDecision>
  /** Optional user-question waiter (lease-gated via SessionRuntime.respondQuestion). */
  onQuestion?: (interaction: PendingInteraction) => Promise<QuestionAnswers>
  /** Optional plan-approval waiter (lease-gated via SessionRuntime.respondPlan). */
  onPlan?: (interaction: PendingInteraction) => Promise<PlanDecisionResult>
  signal: AbortSignal
}) => Promise<{
  finalText: string
  providerResume?: string | null
  /** Steer / mid-turn inject: do not append an assistant transcript block. */
  skipAssistantTranscript?: boolean
}>) & {
  /** Tear down long-lived harness state for one SuperOne session id. */
  disposeSession?: (sessionId: string) => void | Promise<void>
  /** Tear down all long-lived harness state (runtime stop). */
  disposeAll?: () => void | Promise<void>
  /** Snapshot long-lived harness state for the host's idle runtime reaper. */
  listActiveRuntimes?: () => ActiveHarnessRuntime[]
}

export type { SessionTurnEvent }
