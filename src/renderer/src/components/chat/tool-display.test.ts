import { describe, expect, it } from 'vitest'
import { getToolDisplay, parseMcpToolName, parseToolInput, shortenPath } from './tool-display'

describe('shortenPath', () => {
  it('shortens paths relative to cwd and homedir', () => {
    const cwd = '/Users/demo/workspace'
    const home = '/Users/demo'

    expect(shortenPath('/Users/demo/workspace/src/main.ts', cwd, home)).toBe('src/main.ts')
    expect(shortenPath('/Users/demo/workspace', cwd, home)).toBe('.')
    expect(shortenPath('/Users/demo/.claude/config.json', cwd, home)).toBe('~/.claude/config.json')
    expect(shortenPath('/Users/demo', cwd, home)).toBe('~')
  })

  it('keeps unknown paths unchanged', () => {
    expect(shortenPath('/opt/data/file.txt', '/Users/demo/workspace', '/Users/demo')).toBe('/opt/data/file.txt')
  })
})

describe('parseMcpToolName', () => {
  it('parses valid MCP tool names', () => {
    expect(parseMcpToolName('mcp__filesystem__read_file')).toEqual({
      serverName: 'filesystem',
      mcpToolName: 'read_file',
    })
  })

  it('returns null for invalid MCP tool names', () => {
    expect(parseMcpToolName('Read')).toBeNull()
  })
})

describe('getToolDisplay', () => {
  it('maps builtin tools to icon and summary', () => {
    expect(getToolDisplay('Bash', { command: 'ls -la' })).toEqual({
      icon: 'terminal',
      summary: 'ls -la',
    })

    expect(getToolDisplay('Read', { file_path: '/Users/demo/workspace/README.md' }, '/Users/demo/workspace', '/Users/demo')).toEqual({
      icon: 'file-text',
      summary: 'README.md',
    })

    expect(getToolDisplay('AskUserQuestion', { questions: [{ id: 'q1' }, { id: 'q2' }] })).toEqual({
      icon: 'message-circle',
      summary: '2 questions',
    })
  })

  it('maps MCP tools to plug icon', () => {
    expect(getToolDisplay('mcp__filesystem__read_file', {})).toEqual({
      icon: 'plug',
      summary: '',
    })
  })
})

describe('parseToolInput', () => {
  it('parses valid json and falls back to empty object for invalid json', () => {
    expect(parseToolInput('{"a":1}')).toEqual({ a: 1 })
    expect(parseToolInput('{invalid')).toEqual({})
  })

  it('treats raw bash input as a command', () => {
    expect(parseToolInput('ls -la', 'Bash')).toEqual({ command: 'ls -la' })
  })

  it('extracts partial Edit fields from incomplete streaming JSON', () => {
    const partial = '{"file_path":"/tmp/a.ts","old_string":"foo","new_string":"bar'
    expect(parseToolInput(partial, 'Edit')).toEqual({
      file_path: '/tmp/a.ts',
      old_string: 'foo',
      new_string: 'bar',
    })
  })

  it('extracts partial Write content from incomplete streaming JSON', () => {
    const partial = '{"file_path":"/tmp/a.ts","content":"line1\\nline2'
    expect(parseToolInput(partial, 'Write')).toEqual({
      file_path: '/tmp/a.ts',
      content: 'line1\nline2',
    })
  })

  it('extracts partial FileChange fields from incomplete streaming JSON', () => {
    const partial = '{"file_path":"/tmp/a.ts","kind":"edit","diff":"@@ -1 +1 @@\\n-old'
    expect(parseToolInput(partial, 'FileChange')).toEqual({
      file_path: '/tmp/a.ts',
      kind: 'edit',
      diff: '@@ -1 +1 @@\n-old',
    })
  })

  it('returns complete params once streaming JSON finalizes', () => {
    const complete = '{"file_path":"/tmp/a.ts","old_string":"foo","new_string":"bar"}'
    expect(parseToolInput(complete, 'Edit')).toEqual({
      file_path: '/tmp/a.ts',
      old_string: 'foo',
      new_string: 'bar',
    })
  })
})
