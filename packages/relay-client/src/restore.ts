import type {
  AgentEvent,
  ChatMessage,
  RealtimeTimelineSegment,
  SandboxInfo,
  SessionGoal,
} from '@superone/shared/agent-types'
import type { RelayClient } from './client'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { SessionLoadResult } from '@superone/shared/environment/session-messages'
import type { ProjectRef } from '@superone/shared/environment/refs'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment/descriptor'
import type { McpAppContextSource } from '@superone/shared/mcp-apps-state'

export type HistoryPage = {
  navigationAvailable?: boolean
  messages: ChatMessage[]
  hasMore: boolean
  cursor: number | null
  provider?: string
  error?: string
}

export type SessionSnapshot = {
  sourceEnvironmentId?: string | null
  /** All active context, including Views outside the loaded history pages. */
  mcpAppContexts?: McpAppContextSource[]
  /** Authoritative live turn, including completed rows not yet in persisted history. */
  inProgressMessages?: ChatMessage[]
  pendingInteractions?: AgentEvent[]
  status?: string
  permissionMode?: string
  /** Claude Ultracode, session state the next turn runs with. */
  ultracode?: boolean
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
  /**
   * The session's goal as the host last heard it; null when there is none. The
   * harness reports it only when it changes, so a restore must carry it.
   */
  goal?: SessionGoal | null
  error?: string
}

export type RestoredSession = {
  navigationAvailable?: boolean
  messages: ChatMessage[]
  snapshot: SessionSnapshot
  /** Authoritative reducer state captured with the messages and stream cursor. */
  state?: Record<string, unknown>
  liveBatches: unknown[][]
  epoch: number
  provider?: string
  hasMore: boolean
  cursor: number | null
  metrics: { subscribeMs: number; historyMs: number; snapshotMs: number; totalMs: number; historyBytes: number; snapshotBytes: number }
}

/** A previously opened transcript kept on the phone for this connection. */
export type CachedTranscript = {
  mcpAppContexts?: McpAppContextSource[]
  messages: ChatMessage[]
  provider?: string
  hasMore: boolean
  cursor: number | null
  navigationAvailable?: boolean
}

/**
 * The host answered and refused to restore the session (not found, locked,
 * denied). The link is fine, so redialling cannot change the answer.
 */
export class RestoreRejectedError extends Error {
  override name = 'RestoreRejectedError'
}

/** Keep older cached rows and replace the overlapping tail with the host's newer page. */
export function mergeCachedHistory(cached: ChatMessage[], fresh: ChatMessage[]): { messages: ChatMessage[]; overlapped: boolean } {
  if (cached.length === 0) return { messages: [...fresh], overlapped: true }
  if (fresh.length === 0) return { messages: [...cached], overlapped: true }
  const freshIds = new Set(fresh.map((message) => message.id))
  const overlapAt = cached.findIndex((message) => freshIds.has(message.id))
  if (overlapAt < 0) return { messages: [...fresh], overlapped: false }
  return { messages: [...cached.slice(0, overlapAt), ...fresh], overlapped: true }
}

/** `incoming` is strictly newer than `cached` (a `direction: 'after'` page). */
export function appendHistory(cached: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(cached.map((message) => message.id))
  return [...cached, ...incoming.filter((message) => !ids.has(message.id))]
}

const AFTER_PAGE_SIZE = 40
const AFTER_PAGE_CAP = 20

export function dropIncompleteTail(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length
  while (end > 0) {
    const status = messages[end - 1]?.status
    if (!status || status === 'complete') break
    end -= 1
  }
  return messages.slice(0, end)
}

/** Fill a cached transcript through bounded, stable-anchor pages. The last page owns the restore cursor. */
async function restoreHistory(client: RelayClient, project: ProjectRef, sessionId: string, first: SessionLoadResult, cached?: CachedTranscript | null) {
  const complete = dropIncompleteTail(cached?.messages ?? [])
  const fallback = { loaded: first, messages: first.messages, cursor: first.before, hasMore: first.before != null }
  if (!complete.length || (!first.messages.length && first.before == null)) return fallback
  const overlap = mergeCachedHistory(complete, first.messages)
  if (overlap.overlapped) return { loaded: first, messages: overlap.messages, cursor: cached!.cursor, hasMore: cached!.hasMore }
  let messages = complete
  let anchorId = complete.at(-1)!.id
  for (let i = 0; i < AFTER_PAGE_CAP; i++) {
    let page: SessionLoadResult
    try {
      page = await client.rpc<SessionLoadResult>('session.load', { sessionId, projectId: project.projectId, anchorId, direction: 'after', limit: AFTER_PAGE_SIZE, includeState: false }, { environmentId: project.environmentId })
    } catch (error) {
      // A removed anchor invalidates this cache. Link failures must reach reconnect.
      if ((error as { code?: string }).code === 'not_found') return fallback
      throw error
    }
    messages = appendHistory(messages, page.messages)
    if (page.after == null) return { loaded: page, messages, cursor: cached!.cursor, hasMore: cached!.hasMore }
    const next = page.messages.at(-1)?.id
    if (!next || next === anchorId) break
    anchorId = next
  }
  // A long gap cannot be represented as a contiguous cache; restart with the newest bounded page.
  const loaded = await client.rpc<SessionLoadResult>('session.load', { sessionId, projectId: project.projectId, limit: 8 }, { environmentId: project.environmentId })
  return { loaded, messages: loaded.messages, cursor: loaded.before, hasMore: loaded.before != null }
}

/** Host facts retained for native shell consumers alongside the complete reducer state. */
export function snapshotFromLoad(loaded: SessionLoadResult, environmentId: string): SessionSnapshot {
  const state = { ...createDefaultChatCoreSession(), ...loaded.state } as SessionSnapshot & { sessionGoal?: SessionGoal | null; realtimeSessionId?: string | null }
  return {
    ...loaded.restore,
    sourceEnvironmentId: loaded.restore?.sourceEnvironmentId ?? environmentId,
    inProgressMessages: loaded.activeTurn ?? [],
    status: state.status, permissionMode: state.permissionMode, ultracode: state.ultracode,
    contextTokens: state.contextTokens, totalCostUsd: state.totalCostUsd,
    realtimeSegments: state.realtimeSegments, activeRealtimeSessionId: state.realtimeSessionId,
    goal: state.sessionGoal,
  }
}

const HOST_REFUSALS = new Set(['not_found', 'forbidden', 'failed_precondition', 'lease_stale', 'lease_required', 'identity_conflict', 'unsupported'])

/** Read an atomic snapshot, explicitly acquire control, then follow its cursor. No legacy probes. */
export async function restoreSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  cached?: CachedTranscript | null,
): Promise<RestoredSession> {
  const started = performance.now()
  client.startBuffering()
  try {
    await client.stopSession()
    const project = await client.resolveProject(projectPath)
    const [first, descriptor] = await Promise.all([
      client.rpc<SessionLoadResult>('session.load', { sessionId, projectId: project.projectId, limit: 8 }, { environmentId: project.environmentId }),
      client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor', {}, { environmentId: project.environmentId }),
    ])
    const snapshotAt = performance.now()
    const history = await restoreHistory(client, project, sessionId, first, cached)
    const historyAt = performance.now()
    const session = { environmentId: project.environmentId, sessionId }
    await client.acquireControl(session)
    const loaded = history.loaded
    const provider = typeof loaded.state.sessionProvider === 'string' ? loaded.state.sessionProvider : cached?.provider
    await client.followSession({ session, projectPath, provider, cursor: loaded.cursor })
    const subscribedAt = performance.now()
    const { epoch, batches } = client.releaseBuffer()
    const liveBatches = batches.map(batch => batch.filter(value => {
      const event = value as AgentEvent
      return (!event.environmentId || event.environmentId === session.environmentId)
        && (!event.sessionId || event.sessionId === sessionId)
        && (event.seq == null || event.seq > loaded.cursor.version)
    })).filter(batch => batch.length)
    return {
      messages: history.messages, state: { ...createDefaultChatCoreSession(), ...loaded.state }, snapshot: snapshotFromLoad(loaded, project.environmentId),
      liveBatches, epoch, provider, hasMore: history.hasMore && history.cursor != null, cursor: history.cursor,
      navigationAvailable: descriptor.capabilities.methods.includes('session.historyIndex'),
      metrics: {
        snapshotMs: snapshotAt - started, historyMs: historyAt - snapshotAt, subscribeMs: subscribedAt - historyAt,
        totalMs: subscribedAt - started,
        historyBytes: new TextEncoder().encode(JSON.stringify(history.messages)).length,
        snapshotBytes: new TextEncoder().encode(JSON.stringify(loaded.state)).length,
      },
    }
  } catch (error) {
    client.releaseBuffer()
    await client.stopSession().catch(() => {})
    if (HOST_REFUSALS.has((error as { code?: string }).code ?? '')) throw new RestoreRejectedError((error as Error).message, { cause: error })
    throw error
  }
}
