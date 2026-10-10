import { describe, expect, it, vi } from 'vitest'
import { readCodexSubagentActivity, readCodexTurnProvenance } from './protocol-v162'
import { mapCodexCollabItem, withCodexChildTurn } from './collab-item'
import { createCodexAgentEventMapper } from './agent-event-mapper'
import type { AgentEvent } from '@superone/shared/agent-types'
import { runCodexAppServerTurn } from './app-server-client'

const activity = { type: 'subAgentActivity', id: 'activity-1', kind: 'started', agentThreadId: 'child', agentPath: 'root/child', model: 'actual-model', reasoningEffort: 'high' }

describe('Codex 0.162 metadata', () => {
  it('reads source identities and nullable creation fields without guessing', () => {
    const { type: _type, ...fields } = activity
    expect(readCodexSubagentActivity(activity, 'root', 'turn-1')).toEqual({ ...fields, sourceThreadId: 'root', sourceTurnId: 'turn-1' })
    expect(readCodexSubagentActivity({ ...activity, model: null, reasoningEffort: null }, 'root')).toMatchObject({ agentThreadId: 'child', kind: 'started' })
    expect(readCodexSubagentActivity({ ...activity, model: null }, 'root')).not.toHaveProperty('model')
    expect(readCodexSubagentActivity({ ...activity, reasoningEffort: 'future-effort' }, 'root')?.reasoningEffort).toBe('future-effort')
    expect(readCodexTurnProvenance({ id: 't', rootTurnId: null }, 'root')).toEqual({ threadId: 'root', turnId: 't', rootTurnId: null })
  })

  it.each([null, {}, { ...activity, kind: 'unknown' }, { ...activity, id: '' }, { ...activity, agentThreadId: '' }])('rejects malformed activity %j', raw => {
    expect(readCodexSubagentActivity(raw, 'root')).toBeNull()
  })

  it('retains requested configuration independently for each spawn receiver', () => {
    const spawn = mapCodexCollabItem({ id: 'spawn', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child', 'sibling'], model: 'requested-model', reasoningEffort: 'low' })!
    for (const threadId of spawn.receiverThreadIds) expect(spawn.agentsStates[threadId].requestedConfiguration).toEqual({ model: 'requested-model', reasoningEffort: 'low' })
    const next = mapCodexCollabItem({ id: 'spawn', tool: 'spawnAgent', status: 'completed', model: null, reasoningEffort: null, agentsStates: { child: { status: 'completed' } } }, spawn)!
    expect(next.agentsStates.child.requestedConfiguration).toEqual({ model: 'requested-model', reasoningEffort: 'low' })
    expect(mapCodexCollabItem({ id: 'wait', tool: 'wait', receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed' } }, model: 'unrelated' })?.agentsStates.child.requestedConfiguration).toBeUndefined()
  })

  it('keeps provenance per child turn and preserves roots across sparse completion', () => {
    let item = mapCodexCollabItem({ id: 'spawn', receiverThreadIds: ['child'] })!
    item = withCodexChildTurn(item, 'child', { id: 't1', rootTurnId: 'origin-1' })
    item = withCodexChildTurn(item, 'child', { id: 't1', rootTurnId: null })
    item = withCodexChildTurn(item, 'child', { id: 't2', rootTurnId: 'origin-2' })
    expect(item.agentsStates.child.turns).toEqual({ t1: { threadId: 'child', turnId: 't1', rootTurnId: 'origin-1' }, t2: { threadId: 'child', turnId: 't2', rootTurnId: 'origin-2' } })
  })

  it('emits data-only activity and persists resolved config with completion', () => {
    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({ messageId: 'm', emit: event => events.push(event), turnId: 't', provenance: { threadId: 'root', turnId: 't', rootTurnId: 'origin' }, requestedProvenance: { parentTurnId: 'parent', rootTurnId: 'origin' } })
    mapper.start('root')
    mapper.apply({ method: 'item/started', params: { threadId: 'root', turnId: 't', item: activity } })
    mapper.apply({ method: 'item/completed', params: { threadId: 'root', turnId: 't', item: { ...activity, id: 'done', kind: 'completed', model: null, reasoningEffort: null } } })
    mapper.apply({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 't', status: 'completed', rootTurnId: null } } })
    expect(events.filter(event => event.type === 'codex_subagent_activity')).toHaveLength(2)
    expect(mapper.items()).toEqual([])
    expect(events.find(event => event.type === 'message_complete')).toMatchObject({ metadata: { codex: { rootTurnId: 'origin', requestedProvenance: { parentTurnId: 'parent' }, subagents: { child: { creationConfiguration: { model: 'actual-model', reasoningEffort: 'high' }, activities: expect.any(Array) } } } } })
  })

  it('does not claim another thread or a failed turn lost its metadata', () => {
    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({ messageId: 'm', emit: event => events.push(event) })
    mapper.start('root')
    mapper.apply({ method: 'turn/started', params: { threadId: 'unrelated', turn: { id: 'other', rootTurnId: 'foreign' } } })
    mapper.apply({ method: 'item/completed', params: { threadId: 'unrelated', item: activity } })
    expect(events.some(event => event.type === 'codex_subagent_activity' || event.type === 'codex_turn_metadata')).toBe(false)
    mapper.apply({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 't', rootTurnId: 'origin', status: 'failed' } } })
    expect(events.find(event => event.type === 'codex_turn_metadata')).toMatchObject({ provenance: { turnId: 't', rootTurnId: 'origin' } })
    expect(events.some(event => event.type === 'message_error')).toBe(true)
  })

  it('passes explicit provider IDs to a new turn and records them as requested', async () => {
    const events: AgentEvent[] = []
    const request = vi.fn().mockResolvedValue({ turn: { id: 't', rootTurnId: 'origin' } })
    await runCodexAppServerTurn({ client: { request, nextNotification: async () => ({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 't', status: 'completed' } } }) } as never,
      prompt: 'task', cwd: '/project', threadId: 'root', skipThreadSetup: true, parentTurnId: 'parent', rootTurnId: 'origin', messageId: 'm', onAgentEvent: event => events.push(event), signal: new AbortController().signal })
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ parentTurnId: 'parent', rootTurnId: 'origin' }))
    expect(events.find(event => event.type === 'codex_turn_metadata')).toMatchObject({ provenance: { rootTurnId: 'origin' }, requestedProvenance: { parentTurnId: 'parent', rootTurnId: 'origin' } })
  })

  it('does not forward attribution to an active-turn steer', async () => {
    const request = vi.fn().mockResolvedValue({})
    await runCodexAppServerTurn({ client: { request } as never, prompt: 'task', cwd: '/project', threadId: 'root', turnKind: 'steer', expectedTurnId: 't', parentTurnId: 'parent', rootTurnId: 'origin', signal: new AbortController().signal })
    expect(request).toHaveBeenCalledWith('turn/steer', expect.not.objectContaining({ parentTurnId: expect.anything() }))
    expect(request.mock.calls[0][1]).not.toHaveProperty('rootTurnId')
  })
})
