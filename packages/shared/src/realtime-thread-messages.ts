import type { ChatMessage } from './agent-types'
import { codexAsyncAnswerId, isCodexAsyncAnswer } from './codex-async-question'
import { isRealtimeDelegationMessage, isRealtimeVoiceMessage } from './realtime-transcript'

function threadTurnId(message: ChatMessage): string | undefined {
  return message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
}

function threadMessageKey(message: ChatMessage): string {
  const turnId = threadTurnId(message)
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
  realtime: { threadMessages: readonly ChatMessage[] },
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
  const asyncOverlays = alignAsyncAnswers(local, canonical, aligned)

  const overlays = new Map<number, ChatMessage>()
  const before = new Map<number, ChatMessage[]>()
  const lastAnchor = aligned.findLast((index, providerIndex) => index !== undefined && !asyncOverlays.has(providerIndex))
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
      if (!asyncOverlays.has(index)) nextAnchor = localIndex
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
        // Provider positions and local event sequences are different scales. Keep
        // both so voice activity can still align with locally stamped speech.
        codexTimeline: provider.metadata?.codexTimeline ? {
          ...message.metadata?.codexTimeline,
          ...provider.metadata.codexTimeline,
        } : message.metadata?.codexTimeline,
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

/** Async replies can be saved after their streaming turn, outside the steer anchors. */
function alignAsyncAnswers(
  local: readonly ChatMessage[],
  canonical: readonly ChatMessage[],
  aligned: Array<number | undefined>,
): Set<number> {
  if (!local.some(isCodexAsyncAnswer)) return new Set()
  const answerTurns = new Map<string, string>()
  const sourceIndexes = new Map<string, number>()
  for (const messages of [local, canonical]) {
    for (const [index, message] of messages.entries()) {
      const turnId = threadTurnId(message)
      if (message.role !== 'assistant' || !turnId) continue
      for (const item of message.metadata?.codex?.items ?? []) {
        if (item.type === 'agent_message' && item.questions?.length) {
          const answerId = codexAsyncAnswerId(item.id)
          answerTurns.set(answerId, turnId)
          if (messages === local) sourceIndexes.set(answerId, index)
        }
      }
    }
  }
  const claimed = new Set(aligned.filter((index): index is number => index !== undefined))
  const candidates = new Map<string, number[]>()
  local.forEach((message, index) => {
    if (!isCodexAsyncAnswer(message) || claimed.has(index)) return
    const turnId = answerTurns.get(message.id)
    const text = userText(message)
    if (!turnId || text === null) return
    const key = JSON.stringify([turnId, text])
    const indexes = candidates.get(key) ?? []
    indexes.push(index)
    candidates.set(key, indexes)
  })
  for (const indexes of candidates.values()) indexes.reverse()
  const overlays = new Set<number>()
  canonical.forEach((message, index) => {
    const turnId = threadTurnId(message)
    if (!turnId) return
    let candidate = aligned[index]
    if (candidate === undefined) {
      const text = userText(message)
      if (text === null) return
      // The question identifies the answer's turn; equal text elsewhere is not identity.
      candidate = candidates.get(JSON.stringify([turnId, text]))?.pop()
      if (candidate === undefined) return
      aligned[index] = candidate
    }
    const answer = local[candidate]
    if (!isCodexAsyncAnswer(answer) || answerTurns.get(answer.id) !== turnId) return
    const sourceIndex = sourceIndexes.get(answer.id)
    // A mid-turn echo precedes its source assistant in provider history, but the
    // saved quote follows it. Overlay the identity without moving history across
    // that quote, including when the source turn is outside the loaded page.
    if (sourceIndex === undefined || sourceIndex < candidate) overlays.add(index)
  })
  return overlays
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
