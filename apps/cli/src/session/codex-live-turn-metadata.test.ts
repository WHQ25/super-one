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
  expect(events.find(event => event.type === 'message_complete')).toMatchObject({ metadata: { codex: { rootTurnId: 'origin', requestedProvenance: { parentTurnId: 'parent' }, items: [], subagents: { child: { creationConfiguration: { model: 'actual', reasoningEffort: 'high' } } } } } })
})
