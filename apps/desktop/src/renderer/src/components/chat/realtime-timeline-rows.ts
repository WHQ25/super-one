import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'

/**
 * Below this, a pause reads as ordinary turn-taking rather than a gap in the call.
 * Only longer silences earn a marker — otherwise every row grows a label and the
 * timeline stops being scannable.
 */
const SILENCE_THRESHOLD_SECONDS = 30

export interface RealtimeTimelineRow {
  segment: RealtimeTimelineSegment
  /**
   * Seconds since the call's first stamped utterance. Null when the segment carries
   * no start time — transcripts recorded before stamping existed keep their order but
   * have no place on a scale.
   */
  offsetSeconds: number | null
  /** Silence before this row in seconds, set only when it exceeds the threshold. */
  silenceSeconds: number | null
  /** True on the first row of each call in the timeline. */
  callStart: boolean
  /** Wall clock the call began, for its header. Null when nothing in it is stamped. */
  callStartedAtMs: number | null
}

/**
 * Group segments into calls and place each one on its call's own scale. Codex reuses a
 * thread across calls, so a single timeline can hold several — each restarts at zero
 * rather than measuring from a first call that may have ended hours earlier.
 */
export function buildRealtimeTimelineRows(
  segments: readonly RealtimeTimelineSegment[],
): RealtimeTimelineRow[] {
  const rows: RealtimeTimelineRow[] = []
  let callId: string | null = null
  let callStartedAtMs: number | null = null
  let previousStampMs: number | null = null

  for (const segment of segments) {
    const startsCall = segment.realtimeSessionId !== callId
    if (startsCall) {
      callId = segment.realtimeSessionId
      // The first stamped segment anchors the call; an unstamped opener leaves the
      // anchor unset until one arrives, so later rows still get a usable scale.
      callStartedAtMs = null
      previousStampMs = null
    }
    if (segment.startedAtMs !== undefined && callStartedAtMs === null) {
      callStartedAtMs = segment.startedAtMs
    }

    const offsetSeconds = segment.startedAtMs === undefined || callStartedAtMs === null
      ? null
      : Math.max(0, Math.round((segment.startedAtMs - callStartedAtMs) / 1000))
    const gapSeconds = segment.startedAtMs === undefined || previousStampMs === null
      ? null
      : Math.round((segment.startedAtMs - previousStampMs) / 1000)

    rows.push({
      segment,
      offsetSeconds,
      silenceSeconds: gapSeconds !== null && gapSeconds >= SILENCE_THRESHOLD_SECONDS ? gapSeconds : null,
      callStart: startsCall,
      callStartedAtMs,
    })
    if (segment.startedAtMs !== undefined) previousStampMs = segment.startedAtMs
  }

  // A call's anchor can appear after its first row, so publish it to the whole call.
  let pendingStart: number | null = null
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row.callStartedAtMs !== null) pendingStart = row.callStartedAtMs
    else rows[index] = { ...row, callStartedAtMs: pendingStart }
    if (row.callStart) pendingStart = null
  }
  return rows
}

/** `mm:ss`, widening to `h:mm:ss` only once a call runs past an hour. */
export function formatTimelineOffset(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60) % 60
  const hours = Math.floor(safe / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(safe % 60)}`
    : `${pad(minutes)}:${pad(safe % 60)}`
}
