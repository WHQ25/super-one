import { describe, expect, it } from 'vitest'
import type { AgentEvent, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { RemoteMcpAppFreshness } from './remote-freshness'

const ref = { environmentId: 'connection', sessionId: 's' }
const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view' }
const item: CodexMcpToolCallItem = { type: 'mcp_tool_call', id: 'call', server: 'fixture', tool: 'items', arguments: {}, status: 'in_progress' }
const delta = (phase: 'started' | 'completed', app?: ToolAppAttachment, id = 'call'): AgentEvent => ({ type: 'codex_item_delta', messageId: 'm', phase, item: { ...item, id, ...(app ? { app } : {}) } })

describe('remote MCP App live freshness', () => {
  it('does not use an abandoned start after its session closed', () => {
    const tracker = new RemoteMcpAppFreshness()
    tracker.observe(ref, delta('started'))
    tracker.releaseSession(ref)
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
  })

  it('allows metadata first arriving at completion, then forgets the start', () => {
    const tracker = new RemoteMcpAppFreshness()
    expect(tracker.observe(ref, delta('started'))).toBeUndefined()
    expect(tracker.observe(ref, delta('completed', app))).toBe(app)
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
  })

  it('forgets a start after observing its View or completing without a View', () => {
    const tracker = new RemoteMcpAppFreshness()
    expect(tracker.observe(ref, delta('started', app))).toBe(app)
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
    tracker.observe(ref, delta('started'))
    tracker.observe(ref, delta('completed'))
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
  })

  it('does not carry starts across sessions and clears interrupted message entries', () => {
    const tracker = new RemoteMcpAppFreshness()
    tracker.observe(ref, delta('started'))
    expect(tracker.observe({ ...ref, sessionId: 'other' }, delta('completed', app))).toBeUndefined()
    tracker.observe(ref, { type: 'message_error', messageId: 'm', error: 'interrupted' })
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
  })

  it('bounds abandoned entries by age and count', () => {
    let now = 1
    const tracker = new RemoteMcpAppFreshness(() => now)
    tracker.observe(ref, delta('started'))
    now += 1_800_001
    expect(tracker.observe(ref, delta('completed', app))).toBeUndefined()
    for (let i = 0; i < 1025; i++) tracker.observe(ref, delta('started', undefined, String(i)))
    expect(tracker.observe(ref, delta('completed', app, '0'))).toBeUndefined()
    expect(tracker.observe(ref, delta('completed', app, '1024'))).toBe(app)
  })
})
