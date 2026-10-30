import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractResultText, extractToolEntries, readAgentOutputFile } from './agent-output'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const grokHistory = [
  JSON.stringify({
    type: 'assistant',
    content: 'Scanning session ops',
    tool_calls: [
      { id: 'c1', name: 'grep', arguments: JSON.stringify({ pattern: 'session', path: '/proj' }) },
      { id: 'c2', name: 'read_file', arguments: JSON.stringify({ target_file: '/proj/a.ts' }) },
      { id: 'c3', name: 'search_tool', arguments: JSON.stringify({ query: 'session' }) },
      {
        id: 'c4',
        name: 'use_tool',
        arguments: JSON.stringify({
          tool_name: 'superone__session_collab_send',
          tool_input: { content: 'report', to: 'parent', token: 'secret-token' },
        }),
      },
    ],
  }),
  JSON.stringify({ type: 'tool_result', tool_call_id: 'c1', content: 'hits' }),
  JSON.stringify({ type: 'assistant', content: 'Found 3 local-only gaps.' }),
].join('\n')

describe('agent output transcripts', () => {
  it('reads Grok child chat_history tool calls and the last assistant text', () => {
    expect(extractResultText(grokHistory)).toBe('Found 3 local-only gaps.')
    expect(extractToolEntries(grokHistory, '/proj')).toEqual([
      { toolName: 'Grep', description: 'session in /proj' },
      { toolName: 'Read', description: 'a.ts' },
      { toolName: 'SearchTools', description: 'session' },
      { toolName: 'mcp__superone__session_collab_send', description: '' },
    ])
    expect(JSON.stringify(extractToolEntries(grokHistory, '/proj'))).not.toContain('secret-token')
  })

  it('reads a Claude agent jsonl tool_use and skips a torn tail line', () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/proj/b.ts"}},{"type":"text","text":"done"}]}}',
      'not json',
    ].join('\n')
    expect(extractResultText(raw)).toBe('done')
    expect(extractToolEntries(raw, '/proj')).toEqual([{ toolName: 'Read', description: 'b.ts' }])
  })

  it('returns no rows when the transcript file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-output-'))
    dirs.push(dir)
    const file = join(dir, 'chat_history.jsonl')
    expect(readAgentOutputFile(file)).toEqual({ toolEntries: [] })
    writeFileSync(file, grokHistory)
    expect(readAgentOutputFile(file, '/proj').resultText).toBe('Found 3 local-only gaps.')
    expect(readAgentOutputFile(file, '/proj').toolEntries.map((entry) => entry.toolName)).toEqual([
      'Grep', 'Read', 'SearchTools', 'mcp__superone__session_collab_send',
    ])
  })
})
