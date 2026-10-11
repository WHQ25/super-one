import type { CodexGoal, CodexGoalStatus } from '../agent-types'
import type { MessageDisplayFields } from '../message-display'
import type { PatchSessionSettingsInput } from './gateway'
import type { SessionCreateSelections } from './session-create'
import type { SessionSendSelections } from './session-send'

/**
 * What a window asks of a session through `window.environment`, the same for
 * this desktop (`local`) and a paired node. Main fills in the control lease.
 */

/** A user turn and the selections it runs with. */
export interface SessionSendRequest extends MessageDisplayFields, SessionSendSelections {
  sessionId: string
  text: string
  /** This caller does not optimistically append a user bubble. */
  echoUserMessage?: boolean
  clientMessageId?: string
  /** Desktop project key for AgentEvent routing (`remote:<id>:<path>` for a node). */
  projectPath?: string
  providerId?: string
  /**
   * Host-absolute worktree cwd for this turn (session.cwd). Null/undefined
   * leaves the cwd unchanged; empty string clears it to the project root.
   */
  cwdHostPath?: string | null
  model?: string | null
  /** Reasoning / thinking effort (Claude effort or Codex reasoningEffort). */
  effort?: string | null
  permissionMode?: string | null
  sandboxMode?: string | null
  additionalDirectories?: string[]
  enabledSkills?: string[]
  disabledSkills?: string[]
  /** Image/document attachments (base64); `originalPath` is a full-size copy in the sync zone. */
  images?: Array<{ id?: string; name?: string; mimeType: string; base64: string; originalPath?: string }>
  apiProviderId?: string | null
  /** Codex turn kind. */
  turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
  collaborationMode?: string | Record<string, unknown> | null
  reviewTarget?: unknown
  /** Claude Ultracode toggle; the host switches its process when it differs. */
  ultracode?: boolean
}

export interface SessionCreateRequest {
  projectId: string
  title?: string
  providerId?: string
  harnessId?: string
  cwd?: string | null
  settings?: SessionSettingsPatch
  /** Native creation choices (a draft's session id, worktree, ACP agent) the host resolves before persisting. */
  selections?: SessionCreateSelections
}

export type SessionSettingsPatch = Omit<PatchSessionSettingsInput, 'session' | 'leaseId' | 'generation'>

export interface SessionForkRequestInput {
  sessionId: string
  mode?: 'local' | 'worktree'
  forkFromMessageId?: string
  /** Worktree forks copy uncommitted changes unless this is false. */
  carryLocalChanges?: boolean
}

export interface SessionPermissionAnswer {
  sessionId: string
  interactionId: string
  decision: 'allow' | 'deny' | 'allow_always'
  /** Multi-launch form edits / feedback (session_agents_confirm). */
  formAnswers?: Record<string, unknown>
  /** The multi-launch dialog was cancelled. */
  cancel?: boolean
  reason?: string
  selectedSuggestions?: number[]
}

export interface SessionQuestionAnswer {
  sessionId: string
  interactionId: string
  answers: unknown
  /** Close the question without answering it. */
  dismiss?: boolean
  annotations?: Record<string, unknown>
}

export interface SessionPlanAnswer {
  sessionId: string
  interactionId: string
  decision: 'approve' | 'reject'
  options?: Record<string, unknown>
}

/**
 * Session operations outside the shared node family, reached through one
 * environment call. A host that does not serve one answers `unsupported`.
 */
export interface SessionCallMethods {
  'session.dequeue': { input: { clientMessageId: string }; result: { removed: boolean } }
  'session.steer': { input: { clientMessageId: string; priority?: 'now' | 'next' }; result: { ok: boolean } }
  'session.recap': { input: { auto?: boolean }; result: { ok: boolean } }
  'session.getGoal': { input: Record<string, never>; result: { goal: CodexGoal | null } }
  /** A null objective clears the goal. */
  'session.setGoal': { input: { objective: string | null; status?: CodexGoalStatus }; result: { ok: boolean } }
  /** One answer per question of a Codex agent message's async question item. */
  'session.answerAsyncQuestion': { input: { messageId: string; itemId: string; answers: string[] }; result: { reply: string } }
}
export type SessionCallMethod = keyof SessionCallMethods

export const SESSION_CALL_METHODS: ReadonlySet<SessionCallMethod> = new Set<SessionCallMethod>([
  'session.dequeue', 'session.steer', 'session.recap', 'session.getGoal', 'session.setGoal', 'session.answerAsyncQuestion',
])
/** Calls that only read, so the window takes no control grant for them. */
export const SESSION_CALL_READS: ReadonlySet<SessionCallMethod> = new Set<SessionCallMethod>(['session.getGoal'])
