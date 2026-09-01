import { describe, it, expect } from 'vitest'
import {
  MAX_AGGREGATED_OUTPUT_CHARS,
  appendAggregatedOutput,
  capAggregatedOutput,
} from './codex-command-output'

describe('codex command output cap', () => {
  it('leaves output below the cap untouched', () => {
    expect(appendAggregatedOutput('one\n', 'two\n')).toBe('one\ntwo\n')
    expect(capAggregatedOutput('one\n')).toBe('one\n')
  })

  it('stops growing once the cap is reached', () => {
    const capped = appendAggregatedOutput('', 'x'.repeat(MAX_AGGREGATED_OUTPUT_CHARS + 5_000))

    expect(capped.startsWith('x'.repeat(MAX_AGGREGATED_OUTPUT_CHARS))).toBe(true)
    expect(capped).toContain('output truncated')
    expect(appendAggregatedOutput(capped, 'more output')).toBe(capped)
  })

  // The renderer rebuilds the item from deltas the transport derives with
  // `startsWith`, so a shorter earlier value must stay a prefix of the capped one.
  it('keeps every retained value a prefix of the next', () => {
    const half = 'a'.repeat(MAX_AGGREGATED_OUTPUT_CHARS - 10)
    const capped = appendAggregatedOutput(half, 'b'.repeat(1_000))

    expect(capped.startsWith(half)).toBe(true)
    expect(capped.slice(half.length, MAX_AGGREGATED_OUTPUT_CHARS)).toBe('b'.repeat(10))
  })

  it('caps a full provider snapshot to the same value the deltas produce', () => {
    const full = 'y'.repeat(MAX_AGGREGATED_OUTPUT_CHARS * 2)

    expect(capAggregatedOutput(full)).toBe(appendAggregatedOutput('', full))
    // Idempotent: a later snapshot of an already-capped item does not re-truncate.
    expect(capAggregatedOutput(capAggregatedOutput(full))).toBe(capAggregatedOutput(full))
  })
})
