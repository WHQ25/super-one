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

/** A previously opened transcript kept on the phone for this connection. */
export type CachedTranscript = {
  messages: ChatMessage[]
  provider?: string
  hasMore: boolean
  cursor: number | null
  navigationAvailable?: boolean
}

function rid(): string {
  return crypto.randomUUID?.() ?? `r${Date.now().toString(36)}`
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

type AfterPage = { messages: ChatMessage[]; error: string | null }

async function loadMessagesAfter(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  anchorId: string,
): Promise<AfterPage> {
  const page = await client.request({
    type: 'load_session_messages', requestId: rid(), projectPath, sessionId,
    anchorId, direction: 'after', limit: AFTER_PAGE_SIZE,
  } as RemoteCommand) as HistoryPage
  if (page.error) return { messages: [], error: page.error }
  return { messages: page.messages ?? [], error: null }
}

async function loadAllAfter(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  anchorId: string,
): Promise<AfterPage> {
  let collected: ChatMessage[] = []
  let id = anchorId
  for (let i = 0; i < AFTER_PAGE_CAP; i++) {
    const page = await loadMessagesAfter(client, projectPath, sessionId, id)
    if (page.error) return { messages: collected, error: page.error }
    if (page.messages.length === 0) return { messages: collected, error: null }
    collected = appendHistory(collected, page.messages)
    id = page.messages.at(-1)!.id
    if (page.messages.length < AFTER_PAGE_SIZE) return { messages: collected, error: null }
  }
  return { messages: collected, error: null }
}

async function fillHistoryGap(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  cached: ChatMessage[],
  fresh: ChatMessage[],
): Promise<{ messages: ChatMessage[]; overlapped: boolean }> {
  const complete = dropIncompleteTail(cached)
  const lastId = complete.at(-1)?.id
  if (!lastId) return mergeCachedHistory(complete, fresh)
  const freshIds = new Set(fresh.map((message) => message.id))
  if (freshIds.has(lastId)) return mergeCachedHistory(complete, fresh)
  const after = await loadAllAfter(client, projectPath, sessionId, lastId)
  if (after.error) return mergeCachedHistory(complete, fresh)
  const merged = appendHistory(complete, after.messages)
  return mergeCachedHistory(merged, fresh)
}

export async function restoreSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  cached?: CachedTranscript | null,
): Promise<RestoredSession> {
  const started = performance.now()
  client.startBuffering()
  try {
    const subscribed = await client.request({ type: 'subscribe_session', projectPath, sessionId, progressive: true } as RemoteCommand) as { error?: string; historyPage?: HistoryPage; snapshot?: SessionSnapshot }
    if (subscribed.error) throw new Error(subscribed.error)
    const subscribedAt = performance.now()
    let page = subscribed.historyPage
    if (page?.error) throw new Error(page.error)
    const cachedMessages = dropIncompleteTail(cached?.messages ?? [])
    if (!page && cachedMessages.length === 0) {
      // Only the newest page belongs to restore. Older pages are user-driven.
      page = await client.request({
        type: 'load_session_messages', requestId: rid(), projectPath, sessionId, limit: 8,
      } as RemoteCommand) as HistoryPage
      if (page.error) throw new Error(page.error)
    }
    const fresh = page?.messages ?? []
    const emptyHostHistory = Boolean(page && !page.error && fresh.length === 0 && !page.hasMore)
    let messages = fresh
    let hasMore = Boolean(page?.hasMore && page.cursor != null)
    let cursor = page?.cursor ?? null
    let navigationAvailable = page?.navigationAvailable
    let provider = page?.provider
    if (cached && cachedMessages.length > 0 && !emptyHostHistory) {
      const overlapped = fresh.some((message) => cachedMessages.some((row) => row.id === message.id))
      let merged: { messages: ChatMessage[]; overlapped: boolean }
      if (!page) {
        const lastId = cachedMessages.at(-1)?.id
        const after = lastId ? await loadAllAfter(client, projectPath, sessionId, lastId) : { messages: [], error: null }
        if (after.error) {
          page = await client.request({
            type: 'load_session_messages', requestId: rid(), projectPath, sessionId, limit: 8,
          } as RemoteCommand) as HistoryPage
          if (page.error) throw new Error(page.error)
          merged = { messages: page.messages ?? [], overlapped: false }
          hasMore = Boolean(page.hasMore && page.cursor != null)
          cursor = page.cursor ?? null
          navigationAvailable = page.navigationAvailable
          provider = page.provider
        } else {
          merged = { messages: appendHistory(cachedMessages, after.messages), overlapped: true }
        }
      } else if (overlapped) {
        merged = mergeCachedHistory(cachedMessages, fresh)
      } else {
        merged = await fillHistoryGap(client, projectPath, sessionId, cachedMessages, fresh)
      }
      messages = merged.messages
      if (merged.overlapped) {
        hasMore = Boolean(cached.hasMore)
        cursor = cached.cursor
      } else {
        hasMore = Boolean(page?.hasMore && page.cursor != null)
        cursor = page?.cursor ?? null
      }
      navigationAvailable = navigationAvailable ?? cached.navigationAvailable
      provider = provider ?? cached.provider
    } else if (emptyHostHistory) {
      messages = []
      hasMore = false
      cursor = null
    }
    const historyAt = performance.now()
    const snapshot = subscribed.snapshot ?? await client.request({
      type: 'get_session_state', requestId: rid(), projectPath, sessionId,
    } as RemoteCommand) as SessionSnapshot
    if (snapshot.error) throw new Error(snapshot.error)
    const snapshotAt = performance.now()
    const { epoch, batches } = client.releaseBuffer()
    return {
      messages, snapshot, liveBatches: batches, epoch,
      provider, hasMore: hasMore && cursor != null,
      cursor, navigationAvailable,
      metrics: { subscribeMs: subscribedAt - started, historyMs: historyAt - subscribedAt,
        snapshotMs: snapshotAt - historyAt, totalMs: snapshotAt - started,
        historyBytes: new TextEncoder().encode(JSON.stringify(page ?? { messages })).length,
        snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot)).length },
    }
  } catch (error) {
    client.releaseBuffer()
    throw error
  }
}
