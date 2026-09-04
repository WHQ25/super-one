import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { isRealtimeDelegationText } from '@superone/shared/realtime-timeline'
import type { CodexRealtimeSessionViewState } from '@/stores/codex-realtime-view'

export function isRealtimeDelegationMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false
  const text = message.content
    .filter((block): block is Extract<ChatMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  return isRealtimeDelegationText(text)
}

/**
 * A spoken transcript item projected onto ChatMessage — not a Codex turn. Its id is
 * synthetic, so anything that resolves a message id against the backing thread
 * (fork, rewind) has nothing to resolve and must not be offered.
 */
export function isRealtimeVoiceMessage(message: ChatMessage): boolean {
  const provenance = message.metadata?.codexTimeline?.provenance
  return provenance === 'realtime-user' || provenance === 'realtime-assistant'
}

function threadMessageKey(message: ChatMessage): string {
  const turnId = message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
  return message.role === 'assistant' && turnId ? `turn:${turnId}` : `message:${message.id}`
}

export interface CodexThreadMergeOptions {
  /**
   * Keep the `<realtime_delegation>` prompts the voice agent injected into the thread.
   * The voice view drops them — it already says the same thing in speech — but the
   * backing-thread view exists to show exactly what Codex was asked to do.
   */
  keepDelegationPrompts?: boolean
}

/**
 * Build the backing Codex Thread without realtime transcript items. Provider timeline
 * copies supply restored history while live chat-store messages overlay matching turns.
 */
export function mergeCodexThreadMessages(
  messages: readonly ChatMessage[],
  realtime: Pick<CodexRealtimeSessionViewState, 'threadMessages'>,
  options: CodexThreadMergeOptions = {},
): ChatMessage[] {
  const drop = (message: ChatMessage): boolean => (
    isRealtimeVoiceMessage(message)
    || (!options.keepDelegationPrompts && isRealtimeDelegationMessage(message))
  )
  const merged = realtime.threadMessages.filter((message) => !drop(message))
  const indexes = new Map(merged.map((message, index) => [threadMessageKey(message), index]))

  for (const message of messages) {
    if (drop(message)) continue
    const key = threadMessageKey(message)
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, merged.length)
      merged.push(message)
      continue
    }
    const canonical = merged[existingIndex]
    merged[existingIndex] = {
      ...message,
      id: canonical.id,
      metadata: {
        ...canonical.metadata,
        ...message.metadata,
        codexTimeline: canonical.metadata?.codexTimeline ?? message.metadata?.codexTimeline,
      },
    }
  }
  return merged
}

function segmentKey(segment: RealtimeTimelineSegment): string {
  return segment.sourceItemId ?? segment.id
}

/** Realtime-only transcript in stable provider/local order, including live deltas. */
export function selectRealtimeTranscript(
  realtime: CodexRealtimeSessionViewState,
): RealtimeTimelineSegment[] {
  const byId = new Map<string, RealtimeTimelineSegment>()
  for (const segment of realtime.segments) byId.set(segmentKey(segment), segment)
  for (const item of realtime.liveItems) {
    if (!item.done || item.text.length === 0) continue
    const segment: RealtimeTimelineSegment = {
      id: `live-${item.itemId}`,
      sourceItemId: item.itemId,
      realtimeSessionId: item.realtimeSessionId,
      role: item.role,
      text: item.text,
      provenance: item.role === 'assistant' ? 'realtime-assistant' : 'realtime-user',
      ...(item.localOrder === undefined ? {} : { localOrder: item.localOrder }),
      ...(item.startedAtMs === undefined ? {} : { startedAtMs: item.startedAtMs }),
    }
    byId.set(item.itemId, { ...byId.get(item.itemId), ...segment })
  }
  return [...byId.values()].sort((left, right) => (
    (left.position ?? left.localOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.position ?? right.localOrder ?? Number.MAX_SAFE_INTEGER)
  ))
}

function timelineOrder(message: ChatMessage): number | null {
  return message.metadata?.codexTimeline?.position
    ?? message.metadata?.codexTimeline?.localOrder
    ?? message._lastAppliedSeq
    ?? null
}

/**
 * Whether the visible edge of a mixed Codex thread still belongs to voice mode.
 * A running/negotiating call always wins. Once it ends, a later ordinary Codex
 * turn returns the composer chrome to normal while the earlier voice rows remain
 * rendered in their own presentation.
 */
export function isRealtimeConversationTail(
  messages: readonly ChatMessage[],
  realtime: CodexRealtimeSessionViewState,
): boolean {
  if (realtime.starting || realtime.realtimeSessionId !== null) return true
  const transcript = selectRealtimeTranscript(realtime)
  if (transcript.length === 0) return realtime.hasTimeline

  const latestVoiceOrder = Math.max(...transcript.map((segment) => (
    segment.position ?? segment.localOrder ?? Number.MIN_SAFE_INTEGER
  )))
  const ordinary = messages.filter((message) => (
    message.metadata?.codexTimeline?.provenance !== 'realtime-delegated'
  ))
  const unpositioned = ordinary.filter((message) => timelineOrder(message) === null)
  if (unpositioned.length > 0) {
    const latestVoiceTimestamp = Math.max(
      Number.MIN_SAFE_INTEGER,
      ...transcript.map((segment) => segment.startedAtMs ?? Number.MIN_SAFE_INTEGER),
    )
    // A local user row has no event sequence. Its timestamp still tells us which
    // side of a newly observed voice call it belongs to; legacy rows with neither
    // signal remain conservative and restore ordinary mode rather than hiding UI.
    if (latestVoiceTimestamp === Number.MIN_SAFE_INTEGER) return false
    const timestamps = unpositioned.map((message) => Date.parse(message.createdAt))
    if (timestamps.some(Number.isNaN) || Math.max(...timestamps) > latestVoiceTimestamp) return false
  }
  const latestOrdinaryOrder = Math.max(
    Number.MIN_SAFE_INTEGER,
    ...ordinary.map((message) => timelineOrder(message) ?? Number.MIN_SAFE_INTEGER),
  )
  return latestVoiceOrder >= latestOrdinaryOrder
}

/**
 * Project spoken segments onto the ordinary ChatMessage shape so the voice line renders
 * through the same ChatMessage component as a typed turn. No `metadata.codex` on
 * purpose: CodexTurnView then falls back to plain markdown, which is all speech is.
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

export function realtimeSegmentToMessage(segment: RealtimeTimelineSegment): ChatMessage {
  return realtimeSegmentsToMessage([segment])
}

/** Backward-compatible name for callers that need only the foreground voice line. */
export function mergeCodexRealtimeMessages(
  _messages: readonly ChatMessage[],
  realtime: CodexRealtimeSessionViewState,
): ChatMessage[] {
  return selectRealtimeTranscript(realtime).map(realtimeSegmentToMessage)
}
