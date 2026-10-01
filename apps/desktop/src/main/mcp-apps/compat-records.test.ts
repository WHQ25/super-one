import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { mapInteractionUpdate } from '@superone/cursor'
import { CompatRecords } from './compat-records'

const app = { binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'f' },
  resourceUri: 'ui://fixture/items.html', status: 'result' as const, toolResult: { content: [], _meta: { secret: 'view-only' } } }
const start = (id: string, name = 'miniapp_call'): AgentEvent => ({ type: 'content_delta', messageId: 'm',
  delta: { type: 'tool_use', toolUseId: id, toolName: `mcp__superone__${name}`, input: '{}' } })
const result = (id: string, summary: string): AgentEvent => ({ type: 'content_delta', messageId: 'm',
  delta: { type: 'tool_result', toolUseId: id, summary } })

describe('compatibility App record correlation', () => {
  it('claims only a real miniapp_call result in its session and rejects forgery/replay', () => {
    const records = new CompatRecords('s')
    const record = records.record(app)
    records.attach(start('other', 'session_read'))
    expect(records.attach(result('other', record.marker))).not.toHaveProperty('delta.app')
    expect(new CompatRecords('other').attach(result('call', record.marker))).not.toHaveProperty('delta.app')
    records.attach(start('call'))
    expect(records.attach({ ...result('call', record.marker), sessionId: 'other' })).not.toHaveProperty('delta.app')
    expect(records.attach({ ...result('call', record.marker), messageId: 'another-message' })).not.toHaveProperty('delta.app')
    expect(records.attach(result('forged', '[superone-mcp-app:11111111-1111-4111-8111-111111111111]'))).not.toHaveProperty('delta.app')
    expect(records.attach(result('call', record.marker))).toMatchObject({ delta: { app: {
      appInstanceId: record.id, gatewayCallId: record.id, harnessCallId: 'call', toolResult: app.toolResult,
    } } })
    records.attach(start('replay'))
    expect(records.attach(result('replay', record.marker))).not.toHaveProperty('delta.app')
  })

  it('rejects ids reused by another tool or after the turn completes', () => {
    const records = new CompatRecords('s')
    const record = records.record(app)
    records.attach(start('reused')); records.attach(start('reused', 'session_read'))
    expect(records.attach(result('reused', record.marker))).not.toHaveProperty('delta.app')
    records.attach(start('finished'))
    records.attach({ type: 'message_complete', messageId: 'm' } as AgentEvent)
    expect(records.attach(result('finished', record.marker))).not.toHaveProperty('delta.app')
  })

  it('correlates concurrent identical calls by their returned record ids regardless of result order', () => {
    const records = new CompatRecords('s')
    const a = records.record(app), b = records.record(app)
    expect(a.id).not.toBe(b.id)
    records.attach(start('a')); records.attach(start('b'))
    expect(records.attach(result('b', b.marker))).toMatchObject({ delta: { app: { appInstanceId: b.id, harnessCallId: 'b' } } })
    expect(records.attach(result('a', a.marker))).toMatchObject({ delta: { app: { appInstanceId: a.id, harnessCallId: 'a' } } })
  })

  it('survives the real Cursor text-only MCP mapper and its summary truncation', () => {
    const records = new CompatRecords('s')
    const record = records.record(app)
    const events = mapInteractionUpdate('m', { type: 'tool-call-completed', callId: 'cursor-call', toolCall: {
      type: 'mcp', args: { providerIdentifier: 'superone', toolName: 'miniapp_call', args: {} },
      result: { status: 'success', value: { content: [
        { type: 'text', text: record.marker }, { type: 'text', text: 'x'.repeat(60_000) },
      ] } },
    } } as never).map(event => records.attach(event))
    expect(events.at(-1)).toMatchObject({ delta: { app: { appInstanceId: record.id, harnessCallId: 'cursor-call' } } })
  })
})
