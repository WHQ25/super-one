import { describe, expect, it } from 'vitest'
import {
  formatAgentToolOutput,
  formatTranscriptToolResult,
  normalizeTranscriptTool,
  truncateTranscriptToolResult,
  uiToolNameFromId,
} from './tool-ui'

describe('uiToolNameFromId', () => {
  it('maps Grok ids to Claude-shaped UI names', () => {
    expect(uiToolNameFromId('read_file')).toBe('Read')
    expect(uiToolNameFromId('run_terminal_command')).toBe('Bash')
    expect(uiToolNameFromId('search_replace')).toBe('Edit')
  })

  it('rejects human titles', () => {
    expect(uiToolNameFromId('Web search:')).toBeNull()
    expect(uiToolNameFromId('List `/tmp`')).toBeNull()
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
