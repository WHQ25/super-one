import { describe, it, expect } from 'vitest'
import { serializeTraceData } from './event-trace'

describe('serializeTraceData', () => {
  it('leaves an ordinary payload byte-identical to JSON.stringify', () => {
    const event = { type: 'content_delta', delta: { toolUseId: 'exec-1', outputDelta: 'done\n' } }
    expect(serializeTraceData(event)).toBe(JSON.stringify(event))
  })

  // A grep over a large tree can stream megabytes of command output in one event.
  it('caps an oversized string and stays parseable', () => {
    const output = 'x'.repeat(2_000_000)
    const json = serializeTraceData({ type: 'content_delta', delta: { outputDelta: output } })

    expect(json.length).toBeLessThan(20_000)
    const parsed = JSON.parse(json) as { delta: { outputDelta: string } }
    expect(parsed.delta.outputDelta.startsWith('xxxx')).toBe(true)
    expect(parsed.delta.outputDelta).toContain('chars truncated')
  })

  it('caps a payload that is large by breadth rather than by one field', () => {
    const json = serializeTraceData(Array.from({ length: 40_000 }, (_, i) => ({ i, v: 'abcdefgh' })))

    // The head is re-escaped into the wrapper, so the row lands within a small
    // multiple of the 256K cap rather than exactly on it.
    expect(json.length).toBeLessThan(600_000)
    const parsed = JSON.parse(json) as { truncated: boolean; chars: number; head: string }
    expect(parsed.truncated).toBe(true)
    expect(parsed.chars).toBeGreaterThan(600_000)
    expect(parsed.head.startsWith('[{"i":0')).toBe(true)
  })
})


it('redacts nested offers/answers and SDP echoed in receipt errors', () => {
  const sdp = 'v=0\r\na=ice-pwd:private\r\na=fingerprint:private'
  const serialized = serializeTraceData({ command: { request: { sdp } }, result: { transport: { sdp } }, error: `upstream ${JSON.stringify({ sdp })}` })
  expect(serialized).not.toContain('private')
  expect(JSON.parse(serialized).command.request.sdp).toBe('[REDACTED]')
})
