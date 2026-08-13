import { describe, expect, it, vi } from 'vitest'
import {
  createCursorSdkTracer,
  cursorSdkType,
  cursorUserSendTracePayload,
} from './cursor-sdk-trace'

describe('createCursorSdkTracer', () => {
  it('writes raw SDK payloads to agent.sdk like Claude', () => {
    const onSdkTrace = vi.fn()
    const tracer = createCursorSdkTracer(onSdkTrace)
    const update = { type: 'text-delta', text: 'hi' }
    tracer.sdk('text-delta', update, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith('agent.sdk', 'text-delta', update, 'msg-1')
  })

  it('writes host lifecycle to cursor.runtime', () => {
    const onSdkTrace = vi.fn()
    const tracer = createCursorSdkTracer(onSdkTrace)
    tracer.runtime('run_started', { runId: 'run-1', ms: 12 }, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'run_started',
      { runId: 'run-1', ms: 12 },
      'msg-1',
    )
  })

  it('swallows tracer throws so a turn cannot break', () => {
    const tracer = createCursorSdkTracer(() => {
      throw new Error('trace db down')
    })
    expect(() => tracer.sdk('text-delta', { type: 'text-delta' }, 'm')).not.toThrow()
  })

  it('no-ops when no sink is injected', () => {
    const tracer = createCursorSdkTracer()
    expect(() => tracer.sdk('text-delta', { type: 'text-delta' })).not.toThrow()
  })
})

describe('cursorSdkType', () => {
  it('reads the native type field and falls back', () => {
    expect(cursorSdkType({ type: 'tool-call-started' }, 'delta')).toBe('tool-call-started')
    expect(cursorSdkType({}, 'delta')).toBe('delta')
    expect(cursorSdkType(null, 'stream')).toBe('stream')
  })
})

describe('cursorUserSendTracePayload', () => {
  it('keeps plain text raw', () => {
    expect(cursorUserSendTracePayload('hello')).toEqual({ text: 'hello' })
  })

  it('replaces image bytes with length', () => {
    expect(cursorUserSendTracePayload({
      text: 'see',
      images: [{ data: 'abcd', mimeType: 'image/png' }],
    })).toEqual({
      text: 'see',
      images: [{ mimeType: 'image/png', bytes: 4 }],
    })
  })
})
