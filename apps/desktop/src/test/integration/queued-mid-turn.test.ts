/** @vitest-environment jsdom */
/**
 * Recording-driven regression test for the queued-message mid-turn flow.
 *
 * Replays the REAL `agent.emit` stream captured in
 * `scripts/recordings/queued-mid-turn.db` (exported to a JSON fixture) through
 * the REAL chat-store `handleAgentEvent` reducer.
 *
 * Ground truth from the recording (see investigation):
 *   - For each queued message, main-side `Session.forwardEvent` re-enters
 *     `appendUserMessage` on `queued_message_consumed`, fanning ONE consume
 *     into two renderer-bound events with the SAME message id, in order:
 *       1. user_message_appended   (chat.ts reducer dedupes by id)
 *       2. queued_message_consumed (chat.ts reducer does NOT dedupe)
 *   - Renderer optimistically pushes the queued message into
 *     `queuedMessages` at send time; `agent.emit` does not capture that, so
 *     the test re-establishes that precondition before each consume.
 *
 * Bug G: the two reducers disagree on dedupe → the queued message lands in
 * `messages` twice with an identical id → React duplicate-key warning.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import rawFixture from '../fixtures/recordings/queued-mid-turn.emit.json'

const REC_PROJECT = '/Users/wuhangqi25/Developer/Projects/test-super-one'
const QUEUED_TEXTS = ['插入消息1', '插入消息2']

const { useChatStore } = await import('../../renderer/src/stores/chat')

const events = rawFixture as unknown as AgentEvent[]

function messageText(m: ChatMessage): string {
  const block = m.content.find((b) => b.type === 'text') as { text?: string } | undefined
  return block?.text ?? ''
}

function allMessagesInProject(): ChatMessage[] {
  const proj = useChatStore.getState().projectSessions[REC_PROJECT]
  if (!proj) return []
  return Object.values(proj._sessions).flatMap((s) => s.messages)
}

function patchSessionQueued(sessionId: string, msg: ChatMessage): void {
  const state = useChatStore.getState()
  const proj = state.projectSessions[REC_PROJECT]
  if (!proj) return
  const sess = proj._sessions[sessionId]
  if (!sess) return
  if (sess.queuedMessages.some((m) => m.id === msg.id)) return
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [REC_PROJECT]: {
        ...proj,
        _sessions: {
          ...proj._sessions,
          [sessionId]: { ...sess, queuedMessages: [...sess.queuedMessages, msg], status: 'streaming' },
        },
      },
    },
  })
}

function replayRecording(): void {
  const appendedById = new Map<string, ChatMessage>()
  for (const event of events) {
    if (event.type === 'user_message_appended') {
      const m = (event as { message: ChatMessage }).message
      appendedById.set(m.id, m)
    }
    if (event.type === 'queued_message_consumed') {
      const cid = (event as { clientMessageId: string }).clientMessageId
      const sid = (event as { sessionId?: string }).sessionId
      const queuedMsg = appendedById.get(cid)
      // Re-establish the renderer's optimistic precondition that agent.emit
      // does not record: the queued message is sitting in queuedMessages.
      if (queuedMsg && sid) patchSessionQueued(sid, queuedMsg)
    }
    try {
      useChatStore.getState().handleAgentEvent(event)
    } catch {
      /* unrelated event types may touch un-mocked subsystems — tolerated,
         exactly like chat.ts's own replay loop (chat.ts:3076) */
    }
  }
}

beforeEach(() => {
  useChatStore.setState({
    projectSessions: {},
    activeProject: REC_PROJECT,
    remoteSessions: {},
  })
})

describe('queued message mid-turn (recording: queued-mid-turn)', () => {
  it('does not insert a queued message into the transcript twice (Bug G — duplicate React key)', () => {
    replayRecording()

    const msgs = allMessagesInProject()
    const ids = msgs.map((m) => m.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)

    expect(dupes).toEqual([])
  })

  it('each queued message appears exactly once in the final transcript', () => {
    replayRecording()

    const texts = allMessagesInProject().map(messageText)
    for (const queued of QUEUED_TEXTS) {
      expect(texts.filter((t) => t === queued)).toHaveLength(1)
    }
  })

  it('drains queuedMessages once consumed (nothing left stuck in the queue)', () => {
    replayRecording()

    const proj = useChatStore.getState().projectSessions[REC_PROJECT]
    const leftover = Object.values(proj?._sessions ?? {}).flatMap((s) => s.queuedMessages)
    expect(leftover).toEqual([])
  })

  it('keeps the mid-turn transcript correctly ordered and separated', () => {
    replayRecording()
    const msgs = allMessagesInProject()
    const shape = msgs.map((m) => m.role)
    // prompt → turn-1 answer → queued1 → answer → queued2 → answer; each
    // assistant turn is its own bubble (no merge), all settled.
    expect(shape).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length)
    expect(msgs.every((m) => m.status === 'complete')).toBe(true)
  })
})
