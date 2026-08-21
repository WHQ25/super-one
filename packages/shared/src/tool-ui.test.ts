import { describe, expect, it } from 'vitest'
import {
  applyDescriptionPersonaLabel,
  formatAgentToolOutput,
  formatTranscriptToolResult,
  isAlwaysHiddenToolName,
  normalizeTranscriptTool,
  resolveGrokStreamingToolName,
  truncateTranscriptToolResult,
  uiToolNameFromId,
} from './tool-ui'

describe('applyDescriptionPersonaLabel', () => {
  it('promotes a [reviewer] prefix over general-purpose', () => {
    expect(applyDescriptionPersonaLabel('[reviewer] local changes', 'general-purpose')).toEqual({
      description: 'local changes',
      subagentType: 'reviewer',
    })
  })

  it('strips the prefix when type is already specific', () => {
    expect(applyDescriptionPersonaLabel('[reviewer] local changes', 'explore')).toEqual({
      description: 'local changes',
      subagentType: 'explore',
    })
  })

  it('leaves unprefixed descriptions alone', () => {
    expect(applyDescriptionPersonaLabel('Search angle 1', 'general-purpose')).toEqual({
      description: 'Search angle 1',
      subagentType: 'general-purpose',
    })
  })

  it('promotes the prefix when type is empty', () => {
    expect(applyDescriptionPersonaLabel('[implementer] add tests', '')).toEqual({
      description: 'add tests',
      subagentType: 'implementer',
    })
  })
})

describe('uiToolNameFromId', () => {
  it('maps Grok ids to Claude-shaped UI names', () => {
    expect(uiToolNameFromId('read_file')).toBe('Read')
    expect(uiToolNameFromId('run_terminal_command')).toBe('Bash')
    expect(uiToolNameFromId('search_replace')).toBe('Edit')
    expect(uiToolNameFromId('hashline_edit')).toBe('Edit')
    expect(uiToolNameFromId('memory_get')).toBe('MemoryGet')
    expect(uiToolNameFromId('deploy_app')).toBe('DeployApp')
    expect(uiToolNameFromId('lsp')).toBe('Lsp')
    expect(uiToolNameFromId('x_search')).toBe('XSearch')
  })

  it('rejects human titles', () => {
    expect(uiToolNameFromId('Web search:')).toBeNull()
    expect(uiToolNameFromId('List `/tmp`')).toBeNull()
  })
})

describe('resolveGrokStreamingToolName', () => {
  it('maps wire names before the canonical tool_call lands', () => {
    expect(resolveGrokStreamingToolName('search_replace')).toBe('Edit')
    expect(resolveGrokStreamingToolName('todo_write')).toBe('TodoWrite')
    expect(resolveGrokStreamingToolName('use_tool')).toBe('UseTool')
  })

  it('unwraps use_tool once tool_name is in the streamed JSON', () => {
    expect(resolveGrokStreamingToolName(
      'use_tool',
      '{"tool_name":"GitHub__list_issues","tool_input":{',
    )).toBe('mcp__GitHub__list_issues')
    expect(resolveGrokStreamingToolName(
      'use_tool',
      '{"tool_name":"superone__session_rename"',
    )).toBe('mcp__superone__session_rename')
  })

  it('does not unwrap an unclosed tool_name fragment', () => {
    expect(resolveGrokStreamingToolName('use_tool', '{"tool_name":"GitHub__')).toBe('UseTool')
    expect(resolveGrokStreamingToolName('use_tool', '{"tool_name":"superone__sess')).toBe('UseTool')
  })
})

describe('isAlwaysHiddenToolName', () => {
  it('hides Grok wire names on the first streaming chunk', () => {
    expect(isAlwaysHiddenToolName('todo_write')).toBe(true)
    expect(isAlwaysHiddenToolName('TodoWrite')).toBe(true)
    expect(isAlwaysHiddenToolName('use_tool')).toBe(true)
    expect(isAlwaysHiddenToolName('UseTool')).toBe(true)
    expect(isAlwaysHiddenToolName('search_tool')).toBe(true)
    expect(isAlwaysHiddenToolName('mcp__superone__session_rename')).toBe(true)
  })

  it('does not hide ordinary file tools', () => {
    expect(isAlwaysHiddenToolName('read_file')).toBe(false)
    expect(isAlwaysHiddenToolName('Read')).toBe(false)
    expect(isAlwaysHiddenToolName('mcp__GitHub__list_issues')).toBe(false)
  })
})

describe('normalizeTranscriptTool', () => {
  it('aliases target_file and unwraps use_tool MCP envelope', () => {
    expect(normalizeTranscriptTool('read_file', { target_file: '/a.ts' })).toEqual({
      toolName: 'Read',
      input: { target_file: '/a.ts', file_path: '/a.ts' },
    })
    expect(normalizeTranscriptTool('use_tool', {
      tool_name: 'superone__session_rename',
      tool_input: { title: 'x' },
    })).toEqual({
      toolName: 'mcp__superone__session_rename',
      input: { title: 'x' },
    })
  })

  it('aliases Cursor SDK fields onto Claude-shaped ToolBlock input', () => {
    expect(normalizeTranscriptTool('read', { path: 'a.ts' })).toEqual({
      toolName: 'Read',
      input: { path: 'a.ts', file_path: 'a.ts' },
    })
    expect(normalizeTranscriptTool('write', { path: 'a.ts', fileText: 'hi' })).toEqual({
      toolName: 'Write',
      input: { path: 'a.ts', fileText: 'hi', file_path: 'a.ts', content: 'hi' },
    })
    expect(normalizeTranscriptTool('glob', { globPattern: '**/*.ts', targetDirectory: 'src' })).toEqual({
      toolName: 'Glob',
      input: { globPattern: '**/*.ts', targetDirectory: 'src', pattern: '**/*.ts', path: 'src' },
    })
    expect(normalizeTranscriptTool('edit', { path: 'a.ts', diffString: '--- a\n+++ b' })).toEqual({
      toolName: 'Edit',
      input: { path: 'a.ts', diffString: '--- a\n+++ b', file_path: 'a.ts', diff: '--- a\n+++ b' },
    })
  })
})

describe('formatAgentToolOutput', () => {
  it('unwraps MCP and ListDir envelopes', () => {
    expect(formatAgentToolOutput({
      type: 'MCP',
      output: { OkayOutput: 'hello' },
    })).toBe('hello')
    const tree = '- /a\n  - b.ts\n'
    expect(formatAgentToolOutput({
      type: 'ListDir',
      Content: { content: tree, absolute_root_path: '/a' },
    })).toBe(tree)
  })

  it('decodes GrepSearch byte arrays without Buffer', () => {
    const bytes = Array.from(new TextEncoder().encode('match: line 1\n'))
    expect(formatAgentToolOutput({ type: 'GrepSearch', stdout: bytes })).toBe('match: line 1\n')
  })

  it('unwraps shell results to stdout instead of dumping exitCode JSON', () => {
    expect(formatAgentToolOutput({
      exitCode: 0,
      signal: '',
      stdout: 'ok\n',
      stderr: '',
      executionTime: 30_000,
    })).toBe('ok\n')
    expect(formatAgentToolOutput(JSON.stringify({
      exitCode: 0,
      signal: '',
      stdout: 'ok\n',
      stderr: '',
    }))).toBe('ok\n')
    expect(formatAgentToolOutput({
      exitCode: 1,
      stdout: 'out\n',
      stderr: 'err\n',
    })).toBe('out\nerr\n')
  })

  it('unwraps Cursor Grep workspaceResults into match lines', () => {
    expect(formatAgentToolOutput({
      workspaceResults: {
        '/tmp/proj': {
          type: 'content',
          output: {
            matches: [
              { file: 'docs/a.md', lineNumber: 12, line: 'hello' },
              { file: 'src/b.ts' },
            ],
            totalMatches: 1,
          },
        },
      },
    })).toBe('docs/a.md:12:hello\nsrc/b.ts')
    expect(formatAgentToolOutput({
      workspaceResults: {
        '/tmp/a': { type: 'files', output: { files: ['one.ts'], count: 1 } },
        '/tmp/b': { type: 'files', output: { files: ['two.ts'], count: 1 } },
      },
    })).toBe('/tmp/a\none.ts\n/tmp/b\ntwo.ts')
  })

  it('unwraps Cursor Glob files instead of dumping totalFiles JSON', () => {
    expect(formatAgentToolOutput({
      files: ['a.ts', 'b.ts'],
      totalFiles: 2,
      clientTruncated: false,
      ripgrepTruncated: false,
    })).toBe('a.ts\nb.ts')
  })

  it('preserves workflow run_id JSON compactly', () => {
    const raw = { run_id: 'wf_1', message: 'started' }
    expect(JSON.parse(formatAgentToolOutput(raw))).toEqual(raw)
  })
})

describe('formatTranscriptToolResult', () => {
  it('formats then truncates oversized text', () => {
    const long = 'x'.repeat(100)
    const out = formatTranscriptToolResult(long, { maxChars: 40 })
    expect(out.startsWith('x'.repeat(40))).toBe(true)
    expect(out).toContain('truncated')
  })

  it('truncateTranscriptToolResult is a no-op under the cap', () => {
    expect(truncateTranscriptToolResult('short', 100)).toBe('short')
  })
})
