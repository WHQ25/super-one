import type { RealtimeTimelineSegment } from './agent-types'

const REALTIME_DELEGATION_OPEN = '<realtime_delegation>'
const REALTIME_DELEGATION_CLOSE = '</realtime_delegation>'

export function isRealtimeDelegationText(text: string): boolean {
  const normalized = text.trim()
  return normalized.startsWith(REALTIME_DELEGATION_OPEN)
    && normalized.endsWith(REALTIME_DELEGATION_CLOSE)
}

function transcriptKey(segment: RealtimeTimelineSegment): string {
  return JSON.stringify([segment.role, segment.text.trim().replace(/\s+/g, ' ')])
}

/** Remove duplicate canonical entries without collapsing legitimate repeated speech. */
export function dedupeRealtimeTimelineSegments(
  segments: RealtimeTimelineSegment[],
): RealtimeTimelineSegment[] {
  const ids = new Set<string>()
  return segments.filter((segment) => {
    if (ids.has(segment.id)) return false
    ids.add(segment.id)
    return true
  })
}

/**
 * Replace a snapshot with its authoritative copy while retaining temporary
 * segments that have not appeared there yet. Matches are consumed one-to-one
 * so two identical utterances remain two utterances.
 */
export function mergePendingRealtimeTimelineSegments(
  authoritative: RealtimeTimelineSegment[],
  current: RealtimeTimelineSegment[],
  pendingIdPrefixes: readonly string[],
): RealtimeTimelineSegment[] {
  const canonical = dedupeRealtimeTimelineSegments(authoritative)
  const unmatched = new Set(canonical.map((_, index) => index))
  const isPending = (segment: RealtimeTimelineSegment) => (
    pendingIdPrefixes.some((prefix) => segment.id.startsWith(prefix))
  )
  // Codex publishes no timestamps, so a canonical entry only ever carries the start
  // time SuperOne stamped locally. Every match below hands that stamp forward, or a
  // snapshot refresh would silently erase the timeline's scale.
  const stamps = new Map<number, number>()
  const claim = (index: number, segment: RealtimeTimelineSegment) => {
    unmatched.delete(index)
    if (segment.startedAtMs !== undefined) stamps.set(index, segment.startedAtMs)
  }

  // Existing provider entries identify the part of the canonical snapshot we
  // had already observed. Only newly available entries may replace pending UI
  // or database segments with a different id/realtimeSessionId.
  for (const segment of current) {
    if (isPending(segment)) continue
    const index = canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && candidate.id === segment.id
    ))
    if (index >= 0) claim(index, segment)
  }

  // A pending segment committed from the realtime item stream already knows the id
  // its canonical copy will carry. Resolve every such identity before falling back to
  // text, or a still-unpublished utterance could consume the entry that belongs to a
  // published one — Codex repeats text whenever it splits a transcript mid-utterance.
  const unresolved: RealtimeTimelineSegment[] = []
  for (const segment of current) {
    if (!isPending(segment)) continue
    const index = segment.sourceItemId === undefined ? -1 : canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && candidate.id === segment.sourceItemId
    ))
    if (index >= 0) claim(index, segment)
    else unresolved.push(segment)
  }

  const unpublished: RealtimeTimelineSegment[] = []
  for (const segment of unresolved) {
    const key = transcriptKey(segment)
    const index = canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && transcriptKey(candidate) === key
    ))
    if (index >= 0) claim(index, segment)
    else unpublished.push(segment)
  }

  const stamped = canonical.map((segment, index) => {
    const startedAtMs = stamps.get(index)
    return startedAtMs === undefined || segment.startedAtMs !== undefined
      ? segment
      : { ...segment, startedAtMs }
  })
  return dedupeRealtimeTimelineSegments([...stamped, ...unpublished])
}
