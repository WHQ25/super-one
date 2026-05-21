import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { parseJsonlOutput, computeSubagentElapsed } from './subagent-utils'

function line(content: Array<{ type: string; name?: string; text?: string; input?: Record<string, unknown> }>): string {
  return JSON.stringify({ type: 'assistant', message: { content } })
}

describe('parseJsonlOutput', () => {
  it('parses tool_use and text blocks', () => {
    const raw = [
      line([{ type: 'text', text: 'thinking...' }]),
      line([{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }]),
      line([{ type: 'text', text: 'done' }]),
    ].join('\n')

    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({ type: 'activity', text: 'thinking...' })
    expect(entries[1]).toEqual({ type: 'tool', toolName: 'Read', description: '/a.ts' })
    expect(entries[2]).toEqual({ type: 'activity', text: 'done' })
    expect(resultText).toBe('done')
  })

  it('keeps last text entry in entries (not spliced out)', () => {
    const raw = [
      line([{ type: 'text', text: 'first' }]),
      line([{ type: 'text', text: 'second' }]),
    ].join('\n')

    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ type: 'activity', text: 'first' })
    expect(entries[1]).toEqual({ type: 'activity', text: 'second' })
    expect(resultText).toBe('second')
  })

  it('returns undefined resultText when no text blocks', () => {
    const raw = line([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])
    const { entries, resultText } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(1)
    expect(resultText).toBeUndefined()
  })

  it('returns empty entries for invalid first line', () => {
    const { entries, resultText } = parseJsonlOutput('not json')
    expect(entries).toEqual([])
    expect(resultText).toBeUndefined()
  })

  it('skips non-assistant records', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'ignored' }] } }),
      line([{ type: 'text', text: 'kept' }]),
    ].join('\n')

    const { entries } = parseJsonlOutput(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ type: 'activity', text: 'kept' })
  })

  it('handles empty input', () => {
    const { entries, resultText } = parseJsonlOutput('')
    expect(entries).toEqual([])
    expect(resultText).toBeUndefined()
  })
})

describe('computeSubagentElapsed', () => {
  const NOW = 2_000_000_000_000

  function task(extra: Record<string, unknown>): ContentBlock & { type: 'tool_use' } {
    return { type: 'tool_use', toolName: 'Agent', toolUseId: 't', input: '{}', ...extra } as ContentBlock & { type: 'tool_use' }
  }

  it('uses recorded taskUsage.durationMs for a completed agent instead of wall-clock since startedAt', () => {
    const block = task({ startedAt: NOW - 3 * 24 * 3600_000, taskUsage: { totalTokens: 1, toolUses: 1, durationMs: 7139 } })
    expect(computeSubagentElapsed(block, undefined, false, NOW)).toBe(7)
  })

  it('does not use a stale startedAt for a completed agent with no recorded duration', () => {
    const block = task({ startedAt: NOW - 5 * 3600_000 })
    expect(computeSubagentElapsed(block, undefined, false, NOW)).toBe(0)
  })

  it('falls back to live wall-clock while the agent is still running', () => {
    const block = task({ startedAt: NOW - 12_000 })
    expect(computeSubagentElapsed(block, undefined, true, NOW)).toBe(12)
  })

  it('prefers elapsedSeconds over taskUsage and progress', () => {
    const block = task({ elapsedSeconds: 42, taskUsage: { totalTokens: 1, toolUses: 1, durationMs: 99_000 } })
    expect(computeSubagentElapsed(block, { durationMs: 5000 }, false, NOW)).toBe(42)
  })

  it('uses live progress.durationMs when the block carries no recorded duration', () => {
    const block = task({ startedAt: NOW - 999_999 })
    expect(computeSubagentElapsed(block, { durationMs: 8000 }, true, NOW)).toBe(8)
  })
})
