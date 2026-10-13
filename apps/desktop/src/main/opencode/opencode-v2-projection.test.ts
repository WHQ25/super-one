import { describe, expect, it } from 'vitest'
import { openCodeProjectionEvents } from './opencode-v2-projection'
import { OpenCodeV2TurnTranslator } from './opencode-v2-event-map'
import type { OpenCodeV2Event, OpenCodeV2Message } from './opencode-v2-types'

const translator = () => new OpenCodeV2TurnTranslator({ contextWindow: () => 1000 })
const step = { id: 'a', type: 'assistant', agent: 'build', model: { providerID: 'p', id: 'm' }, time: { created: 1, completed: 3 },
  content: [{ type: 'text', text: 'complete' }, { type: 'tool', id: 't', name: 'read', time: { created: 2 }, state: { status: 'completed', input: { path: '/a' }, content: [{ type: 'text', text: 'file' }] } }],
  cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } as OpenCodeV2Message
const native = (type: string, data: object) => ({ id: type, type, data: { sessionID: 's', ...data } }) as OpenCodeV2Event

describe('authoritative current-turn recovery projection', () => {
  it('replaces partial text, preserves terminal tools and settles only its owned execution', () => {
    const turn = translator()
    turn.apply(native('session.inbox.enqueued', { inboxID: 'u', item: { type: 'user', payload: {} } }), 'host')
    turn.apply(native('session.execution.started', {}), 'host')
    turn.apply(native('session.inbox.delivered', { inboxID: 'u' }), 'host')
    turn.apply(native('session.step.started', { assistantMessageID: 'a', agent: 'build', model: { providerID: 'p', id: 'm' } }), 'host')
    turn.apply(native('session.text.started', { assistantMessageID: 'a', ordinal: 4 }), 'host')
    turn.apply(native('session.text.delta', { assistantMessageID: 'a', ordinal: 4, delta: 'com' }), 'host')
    const projection = openCodeProjectionEvents('s', [step, { id: 'idle', type: 'idle', outcome: 'succeeded' } as OpenCodeV2Message])
    const actions = projection.flatMap((event) => turn.apply(event, 'host', true))
    expect(actions).toContainEqual(expect.objectContaining({ type: 'agent', event: expect.objectContaining({ type: 'content_delta', replace: true,
      isReplay: true, delta: { type: 'text', id: 't:a:4', text: 'complete' } }) }))
    expect(actions).toContainEqual({ type: 'complete', interrupted: false })
    const repeated = projection.flatMap((event) => turn.apply(event, 'host', true))
    expect(repeated.some((action) => action.type === 'step_ended')).toBe(false)
    expect(repeated.some((action) => action.type === 'agent' && action.event.type === 'content_delta' && action.event.delta.type === 'tool_use')).toBe(false)
  })
  it('does not repeat a compaction boundary after live completion or repeated snapshot recovery', () => {
    const turn = translator(), data = { reason: 'auto' }
    turn.apply(native('session.compaction.started', data), 'host')
    turn.apply(native('session.compaction.ended', data), 'host')
    const projection = openCodeProjectionEvents('s', [{ id: 'c', type: 'compaction', reason: 'auto', status: 'completed' } as OpenCodeV2Message])
    expect(projection.flatMap((event) => turn.apply(event, 'host', true))).toEqual([])
    expect(projection.flatMap((event) => turn.apply(event, 'host', true))).toEqual([])
  })
  it('correlates replayed native inputs with their original user message', () => {
    const turn = translator()
    const [event] = openCodeProjectionEvents('s', [{ id: 'u', type: 'user', text: 'steered', metadata: { superoneClientMessageId: 'user-2' } } as OpenCodeV2Message])
    expect(turn.apply(event, 'host', true)).toEqual([{ type: 'agent', event: { type: 'checkpoint_captured', messageId: 'host', userMessageId: 'user-2', checkpointId: 'u', resumePointId: 'u' } }])
  })
})
