import type { RealtimeTimelineSegment } from './agent-types'

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

  // Existing provider entries identify the part of the canonical snapshot we
  // had already observed. Only newly available entries may replace pending UI
  // or database segments with a different id/realtimeSessionId.
  for (const segment of current) {
    if (isPending(segment)) continue
    const index = canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && candidate.id === segment.id
    ))
    if (index >= 0) unmatched.delete(index)
  }

  const unpublished: RealtimeTimelineSegment[] = []
  for (const segment of current) {
    if (!isPending(segment)) continue
    const key = transcriptKey(segment)
    const index = canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && transcriptKey(candidate) === key
    ))
    if (index >= 0) unmatched.delete(index)
    else unpublished.push(segment)
  }

  return dedupeRealtimeTimelineSegments([...canonical, ...unpublished])
}
