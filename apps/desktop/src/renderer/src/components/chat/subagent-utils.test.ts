import { describe, expect, it } from 'vitest'
import { parseJsonlOutput } from './subagent-utils'

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
