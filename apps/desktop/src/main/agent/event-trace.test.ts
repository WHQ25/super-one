import { describe, it, expect } from 'vitest'
import { serializeTraceData } from './event-trace'

describe('serializeTraceData', () => {
  it('leaves an ordinary payload byte-identical to JSON.stringify', () => {
    const event = { type: 'codex_item_delta', item: { id: 'exec-1', aggregatedOutput: 'done\n' } }
    expect(serializeTraceData(event)).toBe(JSON.stringify(event))
  })

  // Codex re-emits the whole command item on every output delta, so a grep over a
  // large tree used to write one multi-megabyte row per delta.
  it('caps an oversized string and stays parseable', () => {
    const output = 'x'.repeat(2_000_000)
    const json = serializeTraceData({ type: 'codex_item_delta', item: { aggregatedOutput: output } })

    expect(json.length).toBeLessThan(20_000)
    const parsed = JSON.parse(json) as { item: { aggregatedOutput: string } }
    expect(parsed.item.aggregatedOutput.startsWith('xxxx')).toBe(true)
    expect(parsed.item.aggregatedOutput).toContain('chars truncated')
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
