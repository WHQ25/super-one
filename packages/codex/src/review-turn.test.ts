import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { runCodexAppServerTurn } from './app-server-client'

describe('inline Codex review on a node', () => {
  it('uses review/start identity and waits for its result, ignoring worker completion', async () => {
    const events: AgentEvent[] = []
    const notes = [
      { method: 'turn/started', params: { threadId: 'thread', turn: { id: 'worker', rootTurnId: 'review' } } },
      { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'worker', rootTurnId: 'review', status: 'completed' } } },
      { method: 'item/completed', params: { threadId: 'thread', turnId: 'review', item: { id: 'exit', type: 'exitedReviewMode', review: 'Finding' } } },
      { method: 'item/completed', params: { threadId: 'thread', turnId: 'review', item: { id: 'result', type: 'agentMessage', text: 'Finding' } } },
      { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'review', rootTurnId: 'review', status: 'completed' } } },
    ]
    const nextNotification = vi.fn(async () => {
      const note = notes.shift()
      if (!note) throw new Error('No more notifications')
      return note
    })
    const request = vi.fn(async (method: string) => method === 'review/start' ? { turn: { id: 'review', rootTurnId: null } } : {})
    const result = await runCodexAppServerTurn({
      client: { request, nextNotification } as never,
      cwd: '/project', prompt: '/review', threadId: 'thread', skipThreadSetup: true,
      turnKind: 'review', messageId: 'assistant', onAgentEvent: event => events.push(event),
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ threadId: 'thread', turnId: 'review', finalText: 'Finding' })
    expect(nextNotification).toHaveBeenCalledTimes(5)
    expect(events.filter(event => event.type === 'message_complete')).toHaveLength(1)
    expect(events.filter(event => event.type === 'codex_turn_metadata')).toEqual([
      expect.objectContaining({ provenance: { threadId: 'thread', turnId: 'review', rootTurnId: null } }),
      expect.objectContaining({ provenance: { threadId: 'thread', turnId: 'review', rootTurnId: 'review' } }),
    ])
  })
})
