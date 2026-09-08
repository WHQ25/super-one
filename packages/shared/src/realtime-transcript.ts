import type { ChatMessage, RealtimeTimelineSegment } from './agent-types'
import { isRealtimeDelegationText } from './realtime-timeline'

/**
 * Projecting a Codex realtime ("voice") conversation onto the ordinary transcript.
 *
 * Voice utterances are not stored as chat messages — they live in their own
 * `session_realtime_timelines` row — so any surface that wants to show speech next
 * to typed turns has to merge two stores at read time. The desktop renderer does
 * that with two side-by-side surfaces; the phone is a read-only viewer and shows a
 * single list, which is what `mergeRealtimeTranscript` builds.
 */

/** A spoken turn: one user utterance and every assistant utterance answering it. */
export interface RealtimeConversationTurn {
  id: string
  realtimeSessionId: string
  user: RealtimeTimelineSegment | null
  assistant: RealtimeTimelineSegment[]
}

/**
 * Identity of an utterance across the two ids it can carry. A segment committed
 * locally before Codex published it is keyed `local-<uuid>` but remembers the
 * provider item in `sourceItemId`; the same utterance arriving live is keyed by
 * that item id directly. Keying on the provider id collapses the two.
 */
export function segmentKey(segment: RealtimeTimelineSegment): string {
  return segment.sourceItemId ?? segment.id
}

export function isRealtimeVoiceMessage(message: ChatMessage): boolean {
  const provenance = message.metadata?.codexTimeline?.provenance
  return provenance === 'realtime-user' || provenance === 'realtime-assistant'
}

/**
 * The `<realtime_delegation>` envelope the voice agent injects into the Codex
 * thread. It only materialises when the provider timeline is reconstructed, so it
 * never reaches the phone today — this stays a guard, not a load-bearing filter.
 */
export function isRealtimeDelegationMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false
  return isRealtimeDelegationText(
    message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n'),
  )
}

/**
 * A foreground turn follows the spoken interaction, not backing Codex turns. A new
 * user item always opens a turn (including an interruption); every consecutive
 * assistant item stays attached until the user speaks again.
 */
export function buildRealtimeConversationTurns(
  segments: readonly RealtimeTimelineSegment[],
): RealtimeConversationTurn[] {
  const turns: RealtimeConversationTurn[] = []
  let current: RealtimeConversationTurn | null = null

  for (const segment of segments) {
    const newSession = current?.realtimeSessionId !== segment.realtimeSessionId
    if (newSession || segment.role === 'user' || current === null) {
      current = {
        id: segmentKey(segment),
        realtimeSessionId: segment.realtimeSessionId,
        user: segment.role === 'user' ? segment : null,
        assistant: segment.role === 'assistant' ? [segment] : [],
      }
      turns.push(current)
      continue
    }
    current.assistant.push(segment)
  }

  return turns
}

/**
 * Project spoken segments onto the ordinary ChatMessage shape so a voice line renders
 * through the same component as a typed turn. No `metadata.codex` on purpose:
 * `CodexTurnView` then falls back to plain markdown, which is all speech is.
 *
 * Consecutive segments from one speaker are a single utterance split by the realtime
 * item boundary, not separate turns — they join into one markdown block, and identity
 * follows the first segment so it stays stable as later items arrive.
 */
export function realtimeSegmentsToMessage(segments: readonly RealtimeTimelineSegment[]): ChatMessage {
  const head = segments[0]
  return {
    id: `codex-realtime-${segmentKey(head)}`,
    role: head.role,
    status: 'complete',
    content: [{
      type: 'text',
      text: segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n\n'),
    }],
    createdAt: '',
    providerId: 'codex',
    metadata: {
      codexTimeline: {
        provenance: head.role === 'assistant' ? 'realtime-assistant' : 'realtime-user',
        realtimeSessionId: head.realtimeSessionId,
        sourceItemId: segmentKey(head),
        ...(head.position === undefined ? {} : { position: head.position }),
        ...(head.localOrder === undefined ? {} : { localOrder: head.localOrder }),
      },
    },
  }
}

/** Collapse the same utterance arriving from the database and from the live stream. */
export function dedupeSegmentsByItem(
  segments: readonly RealtimeTimelineSegment[],
): RealtimeTimelineSegment[] {
  const byItem = new Map<string, RealtimeTimelineSegment>()
  for (const segment of segments) {
    const key = segmentKey(segment)
    const existing = byItem.get(key)
    // Later copies win on content but must not drop the local stamps that only the
    // first copy carries — a provider refresh publishes neither.
    byItem.set(key, existing ? { ...existing, ...segment } : segment)
  }
  return [...byItem.values()]
}

function turnStartedAt(turn: RealtimeConversationTurn): number | null {
  let earliest: number | null = null
  for (const segment of [...(turn.user ? [turn.user] : []), ...turn.assistant]) {
    if (segment.startedAtMs === undefined) continue
    if (earliest === null || segment.startedAtMs < earliest) earliest = segment.startedAtMs
  }
  return earliest
}

function turnMessages(turn: RealtimeConversationTurn): ChatMessage[] {
  const rows: ChatMessage[] = []
  if (turn.user) rows.push(realtimeSegmentsToMessage([turn.user]))
  if (turn.assistant.length > 0) rows.push(realtimeSegmentsToMessage(turn.assistant))
  return rows
}

/**
 * Weave spoken turns into the message spine.
 *
 * Deliberately not a sort. `messages` arrives in `sort_order` from the database and
 * that is authoritative — re-deriving it from the metadata available here would make
 * it *worse*, because on a phone the ordering keys have mostly decayed:
 *
 * - `position` is only stamped once a desktop reconciles against the provider, so it
 *   is usually absent, and it shares no scale with a message (which never has one).
 * - `localOrder` comes from a **process-global** counter (`event-seq.ts`), not a
 *   per-session one, so across an app restart it does not lose precision — it
 *   inverts. It is never read here.
 *
 * So the spine is preserved as-is and each spoken turn is spliced in at its wall
 * clock (`startedAtMs`, the one stamp SuperOne controls). A turn with no stamp keeps
 * the cursor where the previous turn left it, which degrades to "voice at the tail"
 * rather than to garbage.
 */
export function mergeRealtimeTranscript(
  messages: readonly ChatMessage[],
  segments: readonly RealtimeTimelineSegment[] | undefined,
): ChatMessage[] {
  const spine = messages.filter((message) => !isRealtimeDelegationMessage(message))
  if (!segments || segments.length === 0) return spine

  const deduped = dedupeSegmentsByItem(segments)
  // Provider positions are authoritative among voice segments, but only once every
  // segment has one; a partial set would sort the stamped ones out of the stream.
  const ordered = deduped.every((segment) => segment.position !== undefined)
    ? [...deduped].sort((left, right) => left.position! - right.position!)
    : deduped

  const spineTimes = spine.map((message) => Date.parse(message.createdAt))
  const out: ChatMessage[] = []
  let cursor = 0

  for (const turn of buildRealtimeConversationTurns(ordered)) {
    const startedAt = turnStartedAt(turn)
    if (startedAt !== null) {
      while (cursor < spine.length) {
        const at = spineTimes[cursor]
        if (Number.isFinite(at) && at > startedAt) break
        out.push(spine[cursor])
        cursor += 1
      }
    }
    out.push(...turnMessages(turn))
  }
  while (cursor < spine.length) {
    out.push(spine[cursor])
    cursor += 1
  }
  return out
}
