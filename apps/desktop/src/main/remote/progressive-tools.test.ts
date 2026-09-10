vi.mock('../remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../agent/claude-session-runtime', () => ({ readOutputFile: vi.fn(() => ({ resultText: '', toolEntries: [] })) }))
vi.mock('../split-text-blocks', () => ({
  splitTextIntoBlocks: vi.fn((text: string) => ({ segments: [{ type: 'text', text }], remainder: '' })),
}))

import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { projectCodexTool, projectTool, toolDetail } from './progressive-tools'

function assistant(content: ChatMessage['content']): ChatMessage {
  return { id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content }
}

describe('progressive file-edit projection', () => {
  it('puts Edit line counts on the collapsed shell without the replaced bodies', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'Edit',
      toolUseId: 't',
      input: JSON.stringify({ file_path: '/proj/a.ts', old_string: 'const enabled = false', new_string: 'const enabled = true' }),
      status: 'complete',
    }, '["m","tool","t"]')
    const wire = JSON.stringify(projected)
    expect(projected).toMatchObject({
      toolName: 'Edit',
      toolLineDelta: { added: 1, removed: 1 },
      remoteDetail: '["m","tool","t"]',
    })
    expect(JSON.parse((projected as { input: string }).input)).toEqual({ file_path: '/proj/a.ts' })
    expect(wire).not.toContain('old_string')
    expect(wire).not.toContain('const enabled')
  })

  it('sends a Cursor host question (canonicalized to AskUserQuestion) to the phone in full, like Claude\'s', () => {
    // cursor-event-map presents `mcp__custom-user-tools__superone_ask_user_question`
    // as `AskUserQuestion`, so the phone gets the same decision prompt shape.
    const block = {
      type: 'tool_use' as const,
      toolName: 'AskUserQuestion',
      toolUseId: 'q1',
      input: JSON.stringify({
        questions: [{ question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }] }],
        answers: { 'Which database?': 'SQLite' },
        annotations: { 'Which database?': { notes: 'keep it embedded' } },
      }),
      status: 'complete' as const,
    }
    const projected = projectTool(block, '["m","tool","q1"]')
    expect(projected).toBe(block)
    expect(projected).not.toHaveProperty('remoteDetail')
    // The raw wire name would have been folded away as generic MCP detail.
    expect(projectTool({ ...block, toolName: 'mcp__custom-user-tools__superone_ask_user_question' }, 'ref')).toMatchObject({ remoteDetail: 'ref' })
  })

  it('puts Write line counts on the collapsed shell without the file contents', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'Write',
      toolUseId: 't',
      input: JSON.stringify({ file_path: 'a.ts', content: 'line1\nline2\nline3' }),
      status: 'complete',
    }, '["m","tool","t"]')
    expect(projected).toMatchObject({ toolLineDelta: { added: 3, removed: 0 } })
    expect(JSON.stringify(projected)).not.toContain('line1')
  })

  it('counts a Grok write_file from contents onto the collapsed shell', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'write_file',
      toolUseId: 't',
      input: JSON.stringify({ target_file: 'a.ts', contents: 'line1\nline2' }),
      status: 'complete',
    }, '["m","tool","t"]')
    expect(projected).toMatchObject({ toolLineDelta: { added: 2, removed: 0 } })
    expect(JSON.stringify(projected)).not.toContain('line1')
  })

  it('counts a Cursor Edit from the folded diff / reported totals', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'Edit',
      toolUseId: 't',
      input: JSON.stringify({
        file_path: '/proj/a.ts',
        diff: '@@ -1,2 +1,3 @@\n line1\n-line2\n+line2b\n+line3',
        linesAdded: 2,
        linesRemoved: 1,
      }),
      status: 'complete',
    }, '["m","tool","t"]')
    expect(projected).toMatchObject({ toolLineDelta: { added: 2, removed: 1 } })
    expect(JSON.parse((projected as { input: string }).input)).toEqual({ file_path: '/proj/a.ts' })
  })

  it('expands an Edit onto a precomputed diff instead of the raw old/new strings', () => {
    const message = assistant([
      {
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 't',
        input: JSON.stringify({ file_path: '/proj/a.ts', old_string: 'const enabled = false', new_string: 'const enabled = true' }),
        status: 'complete',
      },
      { type: 'tool_result', toolUseId: 't', summary: 'Applied 1 edit.' },
    ])
    const detail = JSON.parse(toolDetail(message, 't')) as {
      input: string
      toolDiff?: string
      toolLineDelta?: { added: number; removed: number }
    }
    expect(JSON.parse(detail.input)).toEqual({ file_path: '/proj/a.ts' })
    expect(detail.toolLineDelta).toEqual({ added: 1, removed: 1 })
    expect(detail.toolDiff).toContain('+const enabled = true')
    expect(detail.input).not.toContain('old_string')
  })

  it('keeps Codex file-change line counts after stripping the patch bodies', () => {
    const item: CodexThreadItem = {
      id: 'c',
      type: 'file_change',
      status: 'completed',
      changes: [{
        path: 'src/app.ts',
        kind: 'update',
        diff: '@@ -1,2 +1,2 @@\n export const n = 1\n-const enabled = false\n+const enabled = true',
      }],
    }
    const projected = projectCodexTool(item, '["m","item","c"]')
    expect(projected).toMatchObject({
      type: 'file_change',
      toolLineDelta: { added: 1, removed: 1 },
      changes: [{ path: 'src/app.ts', kind: 'update' }],
    })
    expect(JSON.stringify(projected)).not.toContain('const enabled')
  })

  it('keeps browser screenshot args and the image path on a Codex MCP shell', () => {
    const item: CodexThreadItem = {
      id: 'b',
      type: 'mcp_tool_call',
      server: 'superone',
      tool: 'browser_snapshot',
      arguments: { include: ['screenshot'], description: 'Google home', selector: '#private' },
      result: {
        content: [{ type: 'text', text: JSON.stringify({ path: '/tmp/google.png', width: 960, height: 1636 }) }],
        structuredContent: null,
      },
      status: 'completed',
    }
    const projected = projectCodexTool(item, '["m","item","b"]')
    expect(projected).toMatchObject({
      type: 'mcp_tool_call',
      remoteDetail: '["m","item","b"]',
      arguments: { include: ['screenshot'], description: 'Google home' },
    })
    expect(JSON.stringify(projected)).not.toContain('#private')
    expect(JSON.stringify(projected)).toContain('/tmp/google.png')
  })

  it('puts a Grok Bash description on the collapsed summary, not the ACP title', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'Bash',
      toolUseId: 't',
      input: JSON.stringify({ command: 'ls -la', description: 'List workspace files' }),
      status: 'complete',
      toolSummary: 'Run Command',
    }, '["m","tool","t"]')
    expect(projected).toMatchObject({
      toolName: 'Bash',
      toolSummary: 'List workspace files',
    })
    expect(JSON.parse((projected as { input: string }).input)).toEqual({
      command: 'ls -la',
      description: 'List workspace files',
    })
  })

  it('puts a browser description on the collapsed summary', () => {
    const projected = projectTool({
      type: 'tool_use',
      toolName: 'mcp__superone__browser_snapshot',
      toolUseId: 't',
      input: JSON.stringify({ include: ['screenshot'], description: 'Google home', selector: '#private' }),
      status: 'complete',
    }, '["m","tool","t"]')
    expect(projected).toMatchObject({ toolSummary: 'Google home' })
    expect(JSON.parse((projected as { input: string }).input)).toEqual({
      include: ['screenshot'],
      description: 'Google home',
    })
  })
})
