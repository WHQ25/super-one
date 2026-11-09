import { randomUUID } from 'node:crypto'
import type { AgentEvent, RealtimeTimelineResult } from '@superone/shared/agent-types'
import {
  dedupeRealtimeTimelineSegments,
  mergePendingRealtimeTimelineSegments,
} from '@superone/shared/realtime-timeline'
import { getDb } from '../database'

const EMPTY_TIMELINE: RealtimeTimelineResult = {
  segments: [],
  threadMessages: [],
  activeRealtimeSessionId: null,
  hasTimeline: false,
}

const transcriptStartOrders = new Map<string, number>()
/**
 * Completed lines that arrived before the sessions row existed.
 * A voice draft is not inserted until the first message, so the user's
 * opening line would otherwise be dropped and a later resume has nothing to pair.
 */
const pendingTimelineEvents = new Map<string, AgentEvent[]>()

function transcriptOrderKey(sessionId: string, itemId: string): string {
  return `${sessionId}:${itemId}`
}

function parseTimeline(raw: string): RealtimeTimelineResult | null {
  try {
    const value = JSON.parse(raw) as Partial<RealtimeTimelineResult>
    if (!Array.isArray(value.segments) || !Array.isArray(value.threadMessages)) return null
    return {
      segments: dedupeRealtimeTimelineSegments(value.segments),
      threadMessages: value.threadMessages,
      activeRealtimeSessionId:
        typeof value.activeRealtimeSessionId === 'string' ? value.activeRealtimeSessionId : null,
      hasTimeline: value.hasTimeline === true,
    }
  } catch {
    return null
  }
}

export function loadRealtimeTimeline(sessionId: string): RealtimeTimelineResult | null {
  const row = getDb().prepare(`
    SELECT timeline_json
    FROM session_realtime_timelines
    WHERE session_id = ?
  `).get(sessionId) as { timeline_json: string } | undefined
  return row ? parseTimeline(row.timeline_json) : null
}

/** False when the sessions row is not there yet. The caller keeps the event and retries. */
export function saveRealtimeTimeline(sessionId: string, timeline: RealtimeTimelineResult): boolean {
  const result = getDb().prepare(`
    INSERT INTO session_realtime_timelines (session_id, timeline_json, updated_at)
    SELECT ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?)
    ON CONFLICT(session_id) DO UPDATE SET
      timeline_json = excluded.timeline_json,
      updated_at = excluded.updated_at
  `).run(sessionId, JSON.stringify(timeline), new Date().toISOString(), sessionId) as { changes?: number } | undefined
  if (result && typeof result.changes === 'number') return result.changes > 0
  return true
}

function holdTimelineEvent(sessionId: string, event: AgentEvent): void {
  const pending = pendingTimelineEvents.get(sessionId) ?? []
  pending.push(event)
  pendingTimelineEvents.set(sessionId, pending)
}

/** Write lines that were spoken before this session had a row. No-op when nothing is waiting. */
export function flushPendingRealtimeTimeline(sessionId: string): void {
  const pending = pendingTimelineEvents.get(sessionId)
  if (!pending?.length) return
  pendingTimelineEvents.delete(sessionId)
  for (const event of pending) applyRealtimeTimelineEvent(sessionId, event)
}

/** Replace the provider snapshot while retaining final local segments it has not published yet. */
export function reconcileRealtimeTimeline(
  sessionId: string,
  providerTimeline: RealtimeTimelineResult,
): RealtimeTimelineResult {
  const local = loadRealtimeTimeline(sessionId)
  const segments = mergePendingRealtimeTimelineSegments(
    providerTimeline.segments,
    local?.segments ?? [],
    ['local-'],
  )
  const merged = {
    ...providerTimeline,
    segments,
    // Realtime lifecycle events are persisted before they are sent to the
    // renderer. When a provider snapshot races with start/close, the local row
    // therefore carries the newer liveness state.
    activeRealtimeSessionId: local
      ? local.activeRealtimeSessionId
      : providerTimeline.activeRealtimeSessionId,
    hasTimeline: providerTimeline.hasTimeline || segments.length > 0 || local?.hasTimeline === true,
  }
  saveRealtimeTimeline(sessionId, merged)
  return merged
}

/** Persist durable realtime events without mixing voice transcript into chat_messages. */
export function applyRealtimeTimelineEvent(sessionId: string, event: AgentEvent): void {
  if (
    event.type !== 'realtime_started'
    && event.type !== 'realtime_transcript_item'
    && event.type !== 'realtime_closed'
  ) return

  const current = loadRealtimeTimeline(sessionId) ?? EMPTY_TIMELINE
  if (event.type === 'realtime_started') {
    const started = {
      ...current,
      activeRealtimeSessionId: event.realtimeSessionId ?? current.activeRealtimeSessionId,
      hasTimeline: true,
    }
    if (!saveRealtimeTimeline(sessionId, started)) holdTimelineEvent(sessionId, event)
    return
  }
  if (event.type === 'realtime_closed') {
    for (const key of transcriptStartOrders.keys()) {
      if (key.startsWith(`${sessionId}:`)) transcriptStartOrders.delete(key)
    }
    const closed = { ...current, activeRealtimeSessionId: null, hasTimeline: true }
    if (!saveRealtimeTimeline(sessionId, closed)) holdTimelineEvent(sessionId, event)
    return
  }
  if (event.phase === 'started') {
    if (event.seq !== undefined) transcriptStartOrders.set(transcriptOrderKey(sessionId, event.itemId), event.seq)
    return
  }
  // Only a completed item is durable: Codex has sealed it into the thread rollout by
  // then, and `itemId` is the id its canonical copy will carry.
  if (event.phase !== 'completed' || !event.text || !event.role) return

  const orderKey = transcriptOrderKey(sessionId, event.itemId)
  const localOrder = transcriptStartOrders.get(orderKey) ?? event.seq

  const realtimeSessionId = event.realtimeSessionId
    ?? current.activeRealtimeSessionId
    ?? 'live'
  const segment = {
    id: `local-${randomUUID()}`,
    sourceItemId: event.itemId,
    realtimeSessionId,
    role: event.role,
    text: event.text,
    provenance: event.role === 'assistant' ? 'realtime-assistant' as const : 'realtime-user' as const,
    ...(localOrder === undefined ? {} : { localOrder }),
    ...(event.startedAtMs === undefined ? {} : { startedAtMs: event.startedAtMs }),
  }
  const existing = current.segments.findIndex((candidate) => (
    candidate.sourceItemId === event.itemId || candidate.id === event.itemId
  ))
  const saved = saveRealtimeTimeline(sessionId, {
    ...current,
    segments: existing >= 0
      ? current.segments.map((candidate, index) => (
        index === existing
          ? {
              ...candidate,
              text: segment.text,
              provenance: candidate.provenance ?? segment.provenance,
              localOrder: candidate.localOrder ?? segment.localOrder,
              startedAtMs: candidate.startedAtMs ?? segment.startedAtMs,
            }
          : candidate
      ))
      : [...current.segments, segment],
    hasTimeline: true,
  })
  if (!saved) {
    holdTimelineEvent(sessionId, event)
    return
  }
  transcriptStartOrders.delete(orderKey)
}
