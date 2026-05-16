/** @vitest-environment jsdom */
/**
 * Recording-driven regression test for the queued-message + interrupt flow.
 * Replays the REAL agent.emit stream from scripts/recordings/queued-interrupt.db.
 *
 * Ground truth (see investigation):
 *   - The queued message was already consumed into the CLI command queue
 *     before the interrupt landed, so the CLI answered it in a NEW turn
 *     AFTER the interrupt. The conversation content ends up intact.
 *   - BUG B: that post-interrupt queued turn completes (message_complete)
 *     but the backend never delivers a final status_change → idle, so the
 *     session is stuck in 'streaming' forever (stop button shown, input
 *     disabled). The renderer must settle status on message_complete of the
 *     current turn rather than depend solely on a separate status_change.
 *
 * Two renderer-local preconditions are not captured in agent.emit and are
 * re-established here, exactly as the real app would have them:
 *   - the queued message sits in queuedMessages (renderer optimistic send)
 *   - the recorded session is the active one (user is viewing it), else the
 *     store's "non-active session went idle → evict" cleanup deletes it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import rawFixture from '../fixtures/recordings/queued-interrupt.emit.json'

const REC_PROJECT = '/Users/wuhangqi25/Developer/Projects/test-super-one'
const { useChatStore } = await import('../../renderer/src/stores/chat')
const events = rawFixture as unknown as AgentEvent[]

function messageText(m: ChatMessage): string {
  const b = m.content.find((x) => x.type === 'text') as { text?: string } | undefined
  return b?.text ?? ''
}

function activeSession() {
  const proj = useChatStore.getState().projectSessions[REC_PROJECT]
  if (!proj) return undefined
  return Object.values(proj._sessions)[0]
}

function patchSessionQueued(sessionId: string, msg: ChatMessage): void {
  const state = useChatStore.getState()
  const proj = state.projectSessions[REC_PROJECT]
  if (!proj) return
  const sess = proj._sessions[sessionId]
  if (!sess || sess.queuedMessages.some((m) => m.id === msg.id)) return
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [REC_PROJECT]: {
        ...proj,
        _sessions: { ...proj._sessions, [sessionId]: { ...sess, queuedMessages: [...sess.queuedMessages, msg], status: 'streaming' } },
      },
    },
  })
}

function ensureActiveSession(): void {
  const st = useChatStore.getState()
  const proj = st.projectSessions[REC_PROJECT]
  if (!proj || proj._activeSessionId) return
  const sid = Object.keys(proj._sessions)[0]
  if (!sid) return
  useChatStore.setState({
    projectSessions: { ...st.projectSessions, [REC_PROJECT]: { ...proj, _activeSessionId: sid } },
  })
}

function replayRecording(): void {
  const appendedById = new Map<string, ChatMessage>()
  for (const event of events) {
    if (event.type === 'user_message_appended') {
      const m = (event as unknown as { message: ChatMessage }).message
      appendedById.set(m.id, m)
    }
    if (event.type === 'queued_message_consumed') {
      const cid = (event as unknown as { clientMessageId: string }).clientMessageId
      const sid = (event as unknown as { sessionId?: string }).sessionId
      const qm = appendedById.get(cid)
      if (qm && sid) patchSessionQueued(sid, qm)
    }
    try {
      useChatStore.getState().handleAgentEvent(event)
    } catch {
      /* tolerate unrelated event paths */
    }
    ensureActiveSession()
  }
}

beforeEach(() => {
  useChatStore.setState({ projectSessions: {}, activeProject: REC_PROJECT, remoteSessions: {} })
})

describe('queued message + interrupt (recording: queued-interrupt)', () => {
  it('settles status to idle once the post-interrupt queued turn completes (Bug B — stuck streaming)', () => {
    replayRecording()
    const s = activeSession()
    expect(s?.status).toBe('idle')
  })

  it('keeps the conversation intact: prompt, interrupted turn, queued msg, queued answer', () => {
    replayRecording()
    const msgs = activeSession()?.messages ?? []
    const ids = msgs.map((m) => m.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    expect(msgs.filter((m) => messageText(m) === 'queued msg 1')).toHaveLength(1)
    expect(msgs.some((m) => m.role === 'assistant' && m.status === 'interrupted')).toBe(true)
    expect(msgs.some((m) => messageText(m).includes('收到！这是 queued msg 1'))).toBe(true)
  })

  it('leaves nothing stuck in the queue', () => {
    replayRecording()
    const proj = useChatStore.getState().projectSessions[REC_PROJECT]
    const leftover = Object.values(proj?._sessions ?? {}).flatMap((x) => x.queuedMessages)
    expect(leftover).toEqual([])
  })
})
