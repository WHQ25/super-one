import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import {
  isRealtimeDelegationMessage,
  isRealtimeVoiceMessage,
  realtimeSegmentsToMessage,
  segmentKey,
  suppressRealtimeStartupEcho,
} from '@superone/shared/realtime-transcript'
import type { CodexRealtimeSessionViewState } from '@/stores/codex-realtime-view'

// The projection itself is shared with the phone, which shows the same spoken turns
// in a single read-only transcript. Only the store-bound selectors stay here.
export { isRealtimeDelegationMessage, isRealtimeVoiceMessage, realtimeSegmentsToMessage }

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
 * Build the backing thread on the saved/live message spine. Codex groups a whole
 * turn into one row, while SuperOne splits steers and persists compaction markers.
 * Starting from Codex's rows and appending local-only rows puts those markers after
 * their replies, which the transcript then hides as pre-compaction history.
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
  const local = messages.filter((message) => !drop(message))
  const canonical = realtime.threadMessages.filter((message) => !drop(message))
  // A steer may leave several local segments for one turn. Align the provider's
  // whole-turn row with the last segment; earlier segments stay on the spine.
  const localIndexes = new Map(local.map((message, index) => [threadMessageKey(message), index]))
  const aligned = canonical.map((message) => localIndexes.get(threadMessageKey(message)))
  alignSteeredUsers(local, canonical, aligned)

  const overlays = new Map<number, ChatMessage>()
  const before = new Map<number, ChatMessage[]>()
  const lastAnchor = aligned.findLast((index) => index !== undefined)
  // A snapshot may predate the currently streaming local turn. Its unmatched
  // suffix belongs before that later user row, rather than becoming the tail.
  let nextAnchor = lastAnchor === undefined ? 0 : lastAnchor + 1
  while (nextAnchor < local.length && local[nextAnchor].role !== 'user') nextAnchor += 1
  if (lastAnchor === undefined) nextAnchor = 0
  for (let index = canonical.length - 1; index >= 0; index -= 1) {
    const provider = canonical[index]
    const localIndex = aligned[index]
    if (localIndex === undefined) {
      const bucket = before.get(nextAnchor) ?? []
      bucket.push(provider)
      before.set(nextAnchor, bucket)
    } else {
      nextAnchor = localIndex
      overlays.set(localIndex, provider)
    }
  }

  const merged: ChatMessage[] = []
  for (let index = 0; index <= local.length; index += 1) {
    merged.push(...(before.get(index)?.reverse() ?? []))
    const message = local[index]
    if (!message) break
    const provider = overlays.get(index)
    merged.push(provider ? {
      ...message,
      id: message.role === 'assistant' ? provider.id : message.id,
      metadata: {
        ...provider.metadata,
        ...message.metadata,
        codexTimeline: provider.metadata?.codexTimeline ?? message.metadata?.codexTimeline,
      },
    } : message)
  }
  return merged
}

function userText(message: ChatMessage): string | null {
  // Remote-origin user rows carry providerId='remote', even in a Codex session.
  if (message.role !== 'user') return null
  if (!message.content.every((block) => block.type === 'text')) return null
  const text = message.content.map((block) => block.type === 'text' ? block.text : '').join('\n')
  return text || null
}

/** Codex may assign a steer its own id instead of echoing our client message id. */
function alignSteeredUsers(
  local: readonly ChatMessage[],
  canonical: readonly ChatMessage[],
  aligned: Array<number | undefined>,
): void {
  const claimed = new Set(aligned.filter((index): index is number => index !== undefined))
  const candidates = new Map<string, number[]>()
  local.forEach((message, index) => {
    const text = userText(message)
    if (text === null || claimed.has(index)) return
    const indexes = candidates.get(text) ?? []
    indexes.push(index)
    candidates.set(text, indexes)
  })
  const nextAnchors: number[] = []
  let next = local.length
  for (let index = aligned.length - 1; index >= 0; index -= 1) {
    nextAnchors[index] = next
    next = aligned[index] ?? next
  }
  let previous = -1
  canonical.forEach((message, index) => {
    const match = aligned[index]
    if (match !== undefined) {
      previous = match
      return
    }
    const text = userText(message)
    const end = nextAnchors[index]
    // Text is not a global identity. Only match inside two shared anchors, and
    // consume each occurrence once so repeated instructions remain separate.
    if (text === null || previous < 0 || end === local.length) return
    const candidate = candidates.get(text)?.find((position) => (
      position > previous && position < end && !claimed.has(position)
    ))
    if (candidate === undefined) return
    aligned[index] = candidate
    claimed.add(candidate)
    previous = candidate
  })
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

export function realtimeSegmentToMessage(segment: RealtimeTimelineSegment): ChatMessage {
  return realtimeSegmentsToMessage([segment])
}

/** Backward-compatible name for callers that need only the foreground voice line. */
export function mergeCodexRealtimeMessages(
  messages: readonly ChatMessage[],
  realtime: CodexRealtimeSessionViewState,
): ChatMessage[] {
  return suppressRealtimeStartupEcho(messages, selectRealtimeTranscript(realtime))
    .map(realtimeSegmentToMessage)
}
