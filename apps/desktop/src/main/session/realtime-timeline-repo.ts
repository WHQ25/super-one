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

export function saveRealtimeTimeline(sessionId: string, timeline: RealtimeTimelineResult): void {
  getDb().prepare(`
    INSERT INTO session_realtime_timelines (session_id, timeline_json, updated_at)
    SELECT ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?)
    ON CONFLICT(session_id) DO UPDATE SET
      timeline_json = excluded.timeline_json,
      updated_at = excluded.updated_at
  `).run(sessionId, JSON.stringify(timeline), new Date().toISOString(), sessionId)
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
    saveRealtimeTimeline(sessionId, {
      ...current,
      activeRealtimeSessionId: event.realtimeSessionId ?? current.activeRealtimeSessionId,
      hasTimeline: true,
    })
    return
  }
  if (event.type === 'realtime_closed') {
    saveRealtimeTimeline(sessionId, { ...current, activeRealtimeSessionId: null, hasTimeline: true })
    return
  }
  // Only a completed item is durable: Codex has sealed it into the thread rollout by
  // then, and `itemId` is the id its canonical copy will carry.
  if (event.phase !== 'completed' || !event.text || !event.role) return

  const realtimeSessionId = event.realtimeSessionId
    ?? current.activeRealtimeSessionId
    ?? 'live'
  const segment = {
    id: `local-${randomUUID()}`,
    sourceItemId: event.itemId,
    realtimeSessionId,
    role: event.role,
    text: event.text,
  }
  const existing = current.segments.findIndex((candidate) => (
    candidate.sourceItemId === event.itemId || candidate.id === event.itemId
  ))
  saveRealtimeTimeline(sessionId, {
    ...current,
    segments: existing >= 0
      ? current.segments.map((candidate, index) => (
        index === existing ? { ...candidate, text: segment.text } : candidate
      ))
      : [...current.segments, segment],
    hasTimeline: true,
  })
}
