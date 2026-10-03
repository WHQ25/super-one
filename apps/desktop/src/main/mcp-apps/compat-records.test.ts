import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { MCP_APP_RESULT_MAX_BYTES } from '@superone/shared/mcp-apps'
import { mcpAppEventAttachment } from '@superone/shared/mcp-apps-state'
import { applyContentDelta } from '@superone/shared/content-delta'
import { mapInteractionUpdate } from '@superone/cursor'
import { CompatRecords } from './compat-records'

const app = { binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'f' },
  resourceUri: 'ui://fixture/items.html', status: 'result' as const, toolResult: { content: [], _meta: { secret: 'view-only' } } }
const start = (id: string, name = 'miniapp_call'): AgentEvent => ({ type: 'content_delta', messageId: 'm',
  delta: { type: 'tool_use', toolUseId: id, toolName: `mcp__superone__${name}`, input: '{}' } })
const result = (id: string, summary: string): AgentEvent => ({ type: 'content_delta', messageId: 'm',
  delta: { type: 'tool_result', toolUseId: id, summary } })

describe('compatibility App record correlation', () => {
  afterEach(() => { vi.useRealTimers() })
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

  it('bounds records before attachment and preserves CAS/context through the shared delta merge', () => {
    const records = new CompatRecords('s')
    const record = records.record({ ...app, toolResult: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_RESULT_MAX_BYTES) }] } })
    records.attach(start('call'))
    const initial = mcpAppEventAttachment(records.attach(result('call', record.marker)))!
    expect(initial).toMatchObject({ status: 'result', toolResult: undefined, toolResultOmitted: { reason: 'size_limit' } })
    const resource = { hash: 'a'.repeat(64), meta: { prefersBorder: true } }
    const modelContext = { content: [{ type: 'text', text: 'Selected item' }], source: { appInstanceId: record.id, server: 'fixture' } }
    const previous: ContentBlock = { type: 'tool_result', toolUseId: 'call', summary: record.marker,
      app: { ...initial, resource, modelContext } }
    const merged = applyContentDelta([previous], { type: 'tool_result', toolUseId: 'call', summary: 'final', app: initial })
    expect(merged.at(-1)).toMatchObject({ app: { resource, modelContext, toolResultOmitted: initial.toolResultOmitted } })
    records.clear()
  })

  it('evicts the oldest unclaimed record above 32 while keeping all newer records claimable', () => {
    const records = new CompatRecords('s')
    const all = Array.from({ length: 33 }, () => records.record(app))
    all.forEach((record, index) => {
      const id = `call-${index}`
      records.attach(start(id))
      const attached = records.attach(result(id, record.marker))
      if (index === 0) expect(attached).not.toHaveProperty('delta.app')
      else expect(attached).toMatchObject({ delta: { app: { appInstanceId: record.id } } })
    })
  })

  it('expires idle unclaimed records after five minutes and preserves newer records until their own deadline', () => {
    vi.useFakeTimers()
    const records = new CompatRecords('s')
    const old = records.record(app)
    vi.advanceTimersByTime(60_000)
    const recent = records.record(app)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(4 * 60_000)
    records.attach(start('old'))
    expect(records.attach(result('old', old.marker))).not.toHaveProperty('delta.app')
    records.attach(start('recent'))
    expect(records.attach(result('recent', recent.marker))).toMatchObject({ delta: { app: { appInstanceId: recent.id } } })
    expect(vi.getTimerCount()).toBe(0)
    const idle = records.record(app)
    vi.advanceTimersByTime(5 * 60_000)
    expect(vi.getTimerCount()).toBe(0)
    records.attach(start('idle'))
    expect(records.attach(result('idle', idle.marker))).not.toHaveProperty('delta.app')
  })

  it('cancels expiration and releases records when its session closes', () => {
    vi.useFakeTimers()
    const records = new CompatRecords('s')
    const record = records.record(app)
    records.attach(start('call'))
    records.clear()
    expect(vi.getTimerCount()).toBe(0)
    records.attach(start('again'))
    expect(records.attach(result('again', record.marker))).not.toHaveProperty('delta.app')
  })
})
