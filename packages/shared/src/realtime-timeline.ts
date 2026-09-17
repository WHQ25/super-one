import type { RealtimeTimelineSegment } from './agent-types'

const REALTIME_DELEGATION_OPEN = '<realtime_delegation>'
const REALTIME_DELEGATION_CLOSE = '</realtime_delegation>'

export function isRealtimeDelegationText(text: string): boolean {
  const normalized = text.trim()
  return normalized.startsWith(REALTIME_DELEGATION_OPEN)
    && normalized.endsWith(REALTIME_DELEGATION_CLOSE)
}

export type RealtimeDelegationSource = 'handoff' | 'transcript_tail_flush'

export interface RealtimeTranscriptLine {
  role: string
  text: string
}

/**
 * The envelope Codex's voice agent injects into the thread, decoded:
 *
 *   <realtime_delegation>
 *     [<source>transcript_tail_flush</source>]
 *     <input>…what the voice agent asked Codex to do…</input>
 *     [<transcript_delta>role: text⏎role: text…</transcript_delta>]
 *   </realtime_delegation>
 *
 * `input` is the handoff instruction (or, for a tail flush after the call ends,
 * a fixed "acknowledge the handoff" sentence); `transcript` is the spoken context
 * since the previous handoff. Field text is XML-escaped and capped at 4 KiB.
 */
export interface RealtimeDelegation {
  source: RealtimeDelegationSource
  input: string
  transcript: RealtimeTranscriptLine[]
}

function unescapeXmlText(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function readTag(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)
  return match ? match[1] : null
}

/** Decode a delegation envelope, or null for ordinary text. */
export function parseRealtimeDelegation(text: string): RealtimeDelegation | null {
  if (!isRealtimeDelegationText(text)) return null
  const normalized = text.trim()
  const body = normalized.slice(REALTIME_DELEGATION_OPEN.length, normalized.length - REALTIME_DELEGATION_CLOSE.length)
  const input = readTag(body, 'input')
  const delta = readTag(body, 'transcript_delta')
  return {
    source: readTag(body, 'source')?.trim() === 'transcript_tail_flush' ? 'transcript_tail_flush' : 'handoff',
    // An envelope without fields (older builds) is its own instruction.
    input: unescapeXmlText(input ?? body).trim(),
    transcript: (delta ? unescapeXmlText(delta) : '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(': ')
        return separator > 0
          ? { role: line.slice(0, separator), text: line.slice(separator + 2) }
          : { role: '', text: line }
      }),
  }
}

/** The instruction inside a delegation envelope, or null for ordinary text. */
export function realtimeDelegationText(text: string): string | null {
  return parseRealtimeDelegation(text)?.input ?? null
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
  const localMetadata = new Map<number, Pick<RealtimeTimelineSegment, 'startedAtMs' | 'localOrder'>>()
  const claim = (index: number, segment: RealtimeTimelineSegment) => {
    unmatched.delete(index)
    localMetadata.set(index, {
      ...(segment.startedAtMs === undefined ? {} : { startedAtMs: segment.startedAtMs }),
      ...(segment.localOrder === undefined ? {} : { localOrder: segment.localOrder }),
    })
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

  // A pending segment committed from the realtime item stream knows the provider
  // item id its canonical copy will carry. Entries without that identity remain
  // separate: repeated speech is legitimate and text is not a dedupe key.
  const unpublished: RealtimeTimelineSegment[] = []
  for (const segment of current) {
    if (!isPending(segment)) continue
    const index = segment.sourceItemId === undefined ? -1 : canonical.findIndex((candidate, candidateIndex) => (
      unmatched.has(candidateIndex) && candidate.id === segment.sourceItemId
    ))
    if (index >= 0) claim(index, segment)
    else unpublished.push(segment)
  }

  const stamped = canonical.map((segment, index) => {
    const local = localMetadata.get(index)
    if (!local) return segment
    return {
      ...segment,
      ...(segment.startedAtMs === undefined && local.startedAtMs !== undefined
        ? { startedAtMs: local.startedAtMs }
        : {}),
      ...(segment.localOrder === undefined && local.localOrder !== undefined
        ? { localOrder: local.localOrder }
        : {}),
    }
  })
  return dedupeRealtimeTimelineSegments([...stamped, ...unpublished])
}
