import type { AgentEvent, RetractedBlockRef } from './agent-types'

/**
 * Evicts what a dead API attempt left in our message.
 *
 * `stream_event` is optimistic: a `content_block_start` opens a tool row (and
 * text / thinking deltas grow their blocks) before the API call has finished.
 * When the stream dies mid-way (sleep/wake, dropped socket, idle timeout) the
 * SDK silently re-issues the request — no `api_retry`, no `retracted_message_uuids`,
 * just a fresh `message_start` with new block ids — and the partial blocks of
 * the dead attempt stay behind as ghosts (an `Agent` row stuck on "Spawning
 * subagent…" next to the real one).
 *
 * The `assistant` frame is the authoritative record of an attempt: it names the
 * blocks the API call actually produced. Anything announced by a stream event
 * that no assistant frame confirmed is a ghost. Two eviction points:
 * - `begin()` on the next `message_start` of the same scope (the retry), and
 * - `flush()` at end of turn (the SDK gave up, or the ghost was the last step).
 *
 * Scopes are per `parent_tool_use_id`: subagents stream concurrently with the
 * main model and each may retry independently. Text / thinking refs are only
 * meaningful at top level (`retractContentBlocks` matches own blocks), so nested
 * scopes track tool ids alone.
 */
export interface DeadStreamLedger {
  /** A new API attempt starts in `scope`; evict the previous attempt's ghosts. */
  begin(parentToolUseId: string | null, messageId: string): AgentEvent[]
  announceToolUse(parentToolUseId: string | null, messageId: string, toolUseId: string): void
  announceText(parentToolUseId: string | null, messageId: string, text: string): void
  announceThinking(parentToolUseId: string | null, messageId: string, thinking: string): void
  /** An `assistant` frame in `scope` confirms the blocks it carries. */
  confirm(parentToolUseId: string | null, content: unknown): void
  /** End of turn: evict every attempt still unconfirmed and forget them all. */
  flush(): AgentEvent[]
}

interface Attempt {
  messageId: string
  toolUseIds: Set<string>
  text: string
  thinking: string
}

const scopeKey = (parentToolUseId: string | null): string => parentToolUseId ?? ''

function evict(topLevel: boolean, attempt: Attempt): AgentEvent | null {
  const blocks: RetractedBlockRef[] = [...attempt.toolUseIds].map((toolUseId) => ({ type: 'tool_use', toolUseId }))
  if (topLevel && attempt.text) blocks.push({ type: 'text', text: attempt.text, fromEnd: true })
  if (topLevel && attempt.thinking) blocks.push({ type: 'thinking', thinking: attempt.thinking, fromEnd: true })
  return blocks.length > 0 ? { type: 'content_retracted', messageId: attempt.messageId, blocks } : null
}

export function createDeadStreamLedger(): DeadStreamLedger {
  const attempts = new Map<string, Attempt>()
  const attemptOf = (parentToolUseId: string | null, messageId: string): Attempt => {
    const key = scopeKey(parentToolUseId)
    let attempt = attempts.get(key)
    if (!attempt) {
      attempt = { messageId, toolUseIds: new Set(), text: '', thinking: '' }
      attempts.set(key, attempt)
    }
    return attempt
  }
  return {
    begin(parentToolUseId, messageId) {
      const key = scopeKey(parentToolUseId)
      const previous = attempts.get(key)
      attempts.set(key, { messageId, toolUseIds: new Set(), text: '', thinking: '' })
      const retracted = previous ? evict(key === '', previous) : null
      return retracted ? [retracted] : []
    },
    announceToolUse(parentToolUseId, messageId, toolUseId) {
      if (toolUseId) attemptOf(parentToolUseId, messageId).toolUseIds.add(toolUseId)
    },
    announceText(parentToolUseId, messageId, text) {
      if (parentToolUseId === null) attemptOf(parentToolUseId, messageId).text += text
    },
    announceThinking(parentToolUseId, messageId, thinking) {
      if (parentToolUseId === null) attemptOf(parentToolUseId, messageId).thinking += thinking
    },
    confirm(parentToolUseId, content) {
      const attempt = attempts.get(scopeKey(parentToolUseId))
      if (!attempt || !Array.isArray(content)) return
      for (const block of content as Array<Record<string, unknown>>) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'tool_use' && typeof block.id === 'string') attempt.toolUseIds.delete(block.id)
        else if (block.type === 'text') attempt.text = ''
        else if (block.type === 'thinking') attempt.thinking = ''
      }
    },
    flush() {
      const events: AgentEvent[] = []
      for (const [key, attempt] of attempts) {
        const retracted = evict(key === '', attempt)
        if (retracted) events.push(retracted)
      }
      attempts.clear()
      return events
    },
  }
}
