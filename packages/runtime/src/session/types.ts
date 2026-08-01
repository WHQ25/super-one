import type { SessionTurnEvent } from '@superone/shared/environment'

export type SessionStatus =
  | 'idle'
  | 'streaming'
  | 'interrupted'
  | 'error'
  | 'unknown'
  | 'ended'

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
  createdAt: number
  updatedAt: number
  isPinned: boolean
  isHidden: boolean
  /** Once set, runTurn finalizers must not overwrite closed/ended state. */
  closed?: boolean
}

export interface TranscriptBlock {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
}

export interface PendingInteraction {
  interactionId: string
  kind: 'permission' | 'question' | 'plan'
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
  createdAt: number
}

export type PermissionDecision = 'allow' | 'deny'

/** Default wall-clock wait for a human permission response (ms). */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000

/**
 * Injectable turn runner for harness adapters (Claude, Codex, ACP, OpenCode).
 */
export type TurnRunner = (input: {
  session: NodeSessionRecord
  text: string
  model?: string | null
  onDelta: (text: string) => void
  onEvent?: (event: SessionTurnEvent) => void
  onPermission?: (interaction: PendingInteraction) => Promise<PermissionDecision>
  signal: AbortSignal
}) => Promise<{ finalText: string; providerResume?: string | null }>

export type { SessionTurnEvent }
