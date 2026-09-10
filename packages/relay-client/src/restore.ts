import type {
  AgentEvent,
  ChatMessage,
  RealtimeTimelineSegment,
  RemoteCommand,
  SandboxInfo,
} from '@superone/shared/agent-types'
import type { RelayClient } from './client'

export type HistoryPage = {
  navigationAvailable?: boolean
  messages: ChatMessage[]
  hasMore: boolean
  cursor: number | null
  provider?: string
  error?: string
}

export type SessionSnapshot = {
  /** Authoritative live turn, including completed rows not yet in persisted history. */
  inProgressMessages?: ChatMessage[]
  pendingInteractions?: AgentEvent[]
  status?: string
  permissionMode?: string
  /** Runtime fact — the sandbox this session's process is actually confined by. */
  sandboxInfo?: SandboxInfo
  /**
   * Where the session's process actually runs. Only the host knows this — a
   * remote shell cannot infer it from the project path — and it is the one
   * source that stays right across a reconnect, since restore re-reads it.
   */
  isWorktree?: boolean
  worktreePath?: string | null
  /** Branch recorded when the session was created; a worktree's own branch. */
  gitBranch?: string | null
  contextTokens?: number
  totalCostUsd?: number
  /**
   * Codex realtime ("voice") utterances. They are not chat messages — the host keeps
   * them in their own table — so they ride the snapshot rather than the history pages.
   */
  realtimeSegments?: RealtimeTimelineSegment[]
  activeRealtimeSessionId?: string | null
  error?: string
}

export type RestoredSession = {
  navigationAvailable?: boolean
  messages: ChatMessage[]
  snapshot: SessionSnapshot
  liveBatches: unknown[][]
  epoch: number
  provider?: string
  hasMore: boolean
  cursor: number | null
  metrics: { subscribeMs: number; historyMs: number; snapshotMs: number; totalMs: number; historyBytes: number; snapshotBytes: number }
}

function rid(): string {
  return crypto.randomUUID?.() ?? `r${Date.now().toString(36)}`
}

export async function restoreSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
): Promise<RestoredSession> {
  const started = performance.now()
  client.startBuffering()
  try {
    const subscribed = await client.request({ type: 'subscribe_session', projectPath, sessionId, progressive: true } as RemoteCommand) as { error?: string; historyPage?: HistoryPage; snapshot?: SessionSnapshot }
    if (subscribed.error) throw new Error(subscribed.error)
    const subscribedAt = performance.now()
    // Only the newest page belongs to restore. Older pages are user-driven.
    const page = subscribed.historyPage ?? await client.request({
      type: 'load_session_messages', requestId: rid(), projectPath, sessionId, limit: 8,
    } as RemoteCommand) as HistoryPage
    if (page.error) throw new Error(page.error)
    const historyAt = performance.now()
    const snapshot = subscribed.snapshot ?? await client.request({
      type: 'get_session_state', requestId: rid(), projectPath, sessionId,
    } as RemoteCommand) as SessionSnapshot
    if (snapshot.error) throw new Error(snapshot.error)
    const snapshotAt = performance.now()
    const { epoch, batches } = client.releaseBuffer()
    return {
      messages: page.messages ?? [], snapshot, liveBatches: batches, epoch,
      provider: page.provider, hasMore: page.hasMore && page.cursor != null,
      cursor: page.cursor ?? null, navigationAvailable: page.navigationAvailable,
      metrics: { subscribeMs: subscribedAt - started, historyMs: historyAt - subscribedAt,
        snapshotMs: snapshotAt - historyAt, totalMs: snapshotAt - started,
        historyBytes: new TextEncoder().encode(JSON.stringify(page)).length,
        snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot)).length },
    }
  } catch (error) {
    client.releaseBuffer()
    throw error
  }
}
