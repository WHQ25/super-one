import { expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { openTurnAndStream } from './codex-live-turn'

it('records node live-turn roots and requested attribution without displaying activity', async () => {
  const events: AgentEvent[] = []
  const notes = [
    { method: 'item/completed', params: { threadId: 'root', turnId: 'turn', item: { id: 'activity', type: 'subAgentActivity', kind: 'started', agentThreadId: 'child', agentPath: 'root/child', model: 'actual', reasoningEffort: 'high' } } },
    { method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: 'completed', rootTurnId: null } } },
  ]
  const request = vi.fn().mockResolvedValue({ turn: { id: 'turn', rootTurnId: 'origin' } })
  await openTurnAndStream({ client: { request, nextNotification: async () => notes.shift() ?? null } as never,
    prompt: 'task', cwd: '/project', threadId: 'root', messageId: 'm', parentTurnId: 'parent', rootTurnId: 'origin', signal: new AbortController().signal, onAgentEvent: event => events.push(event) })
  expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ parentTurnId: 'parent', rootTurnId: 'origin' }))
  expect(events.filter(event => event.type === 'codex_turn_metadata')).toHaveLength(1)
  expect(events.some(event => event.type === 'checkpoint_captured')).toBe(false)
  expect(events.find(event => event.type === 'message_complete')).toMatchObject({ metadata: { codex: { rootTurnId: 'origin', requestedProvenance: { parentTurnId: 'parent' }, items: [], subagents: { child: { creationConfiguration: { model: 'actual', reasoningEffort: 'high' } } } } } })
})

it('stamps the user message before the Codex turn starts', async () => {
  const events: AgentEvent[] = []
  const request = vi.fn().mockResolvedValue({ turn: { id: 'turn' } })
  await openTurnAndStream({
    client: { request, nextNotification: async () => ({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } }) } as never,
    prompt: 'task', cwd: '/project', threadId: 'root', messageId: 'asst', clientMessageId: 'user-1',
    signal: new AbortController().signal, onAgentEvent: event => events.push(event),
  })
  expect(events[0]).toEqual({
    type: 'checkpoint_captured', messageId: 'asst', userMessageId: 'user-1', checkpointId: 'user-1', resumePointId: 'user-1',
  })
  expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'root' }))
})
