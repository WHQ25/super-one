import { describe, it, expect } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { mapSessionUpdate, mapStopReason } from './acp-event-map'

const ctx = { messageId: 'msg-1' }

describe('mapSessionUpdate', () => {
  it('maps agent_message_chunk text to content_delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'content_delta',
      messageId: 'msg-1',
      delta: { type: 'text', text: 'Hello' },
    }])
  })

  it('maps agent_thought_chunk to thinking delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'reasoning…' },
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'thinking', thinking: 'reasoning…' },
    })
  })

  it('maps tool_call to tool_use content_delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
      rawInput: { path: '/tmp/a.ts' },
      locations: [{ path: '/tmp/a.ts' }],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolUseId: 'call_1',
        toolName: 'Read file',
        status: 'streaming',
        toolFilePath: '/tmp/a.ts',
      },
    })
  })

  it('maps completed tool_call_update to tool_result', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_1',
      status: 'completed',
      content: [{
        type: 'content',
        content: { type: 'text', text: 'file body' },
      }],
    }
    const events = mapSessionUpdate(update, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'call_1',
        summary: 'file body',
        isError: false,
      },
    })
  })

  it('maps plan entries to markdown checklist text', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Explore', priority: 'high', status: 'completed' },
        { content: 'Implement', priority: 'medium', status: 'in_progress' },
      ],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events[0]?.type).toBe('content_delta')
    if (events[0]?.type === 'content_delta' && events[0].delta.type === 'text') {
      expect(events[0].delta.text).toContain('[x] Explore')
      expect(events[0].delta.text).toContain('[~] Implement')
    }
  })

  it('maps available_commands_update to acp_commands', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'web', description: 'Search the web', input: { hint: 'query' } },
        { name: '/plan', description: 'Make a plan' },
        { name: '', description: 'skip empty' },
      ],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'acp_commands',
      commands: [
        { name: 'web', description: 'Search the web', argumentHint: 'query', isSkill: false },
        { name: 'plan', description: 'Make a plan', argumentHint: '', isSkill: false },
      ],
    }])
  })

  it('ignores unknown update kinds', () => {
    const update = {
      sessionUpdate: 'session_info_update',
      title: 'x',
    } as SessionUpdate
    expect(mapSessionUpdate(update, ctx)).toEqual([])
  })
})

describe('mapStopReason', () => {
  it('marks cancelled as interrupted', () => {
    expect(mapStopReason('cancelled')).toEqual({ complete: false, interrupted: true })
  })

  it('marks end_turn as complete', () => {
    expect(mapStopReason('end_turn')).toEqual({ complete: true, interrupted: false })
  })
})
