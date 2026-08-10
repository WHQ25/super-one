import { describe, expect, it } from 'vitest'
import {
  getToolDisplay,
  getToolLabel,
  isAlwaysHiddenToolBlock,
  parseMcpToolName,
  parseToolInput,
  shortenPath,
} from './tool-display'

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

describe('isAlwaysHiddenToolBlock', () => {
  it('hides miniapp_list (agent discovery, not human-facing)', () => {
    expect(isAlwaysHiddenToolBlock('mcp__superone__miniapp_list')).toBe(true)
  })

  it('does not hide miniapp_call (actual app tool surface)', () => {
    expect(isAlwaysHiddenToolBlock('mcp__superone__miniapp_call')).toBe(false)
  })

  it('does not hide session archive tools (SessionArchiveToolBlock owns the rows)', () => {
    for (const name of [
      'mcp__superone__project_list',
      'mcp__superone__session_list',
      'mcp__superone__session_search',
      'mcp__superone__session_read',
      'mcp__superone__session_cleanup',
    ]) {
      expect(isAlwaysHiddenToolBlock(name)).toBe(false)
    }
  })

  it('still hides session rename and agent-list meta tools', () => {
    expect(isAlwaysHiddenToolBlock('mcp__superone__session_rename')).toBe(true)
    expect(isAlwaysHiddenToolBlock('mcp__superone__session_list_agents')).toBe(true)
    expect(isAlwaysHiddenToolBlock('mcp__superone__session_collab_list_agents')).toBe(true)
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

  it('maps Task tools (TodoWrite successors) to clipboard icon', () => {
    expect(getToolDisplay('TaskCreate', { subject: 'Write tests' })).toEqual({
      icon: 'clipboard-list',
      summary: 'Write tests',
    })
    expect(getToolDisplay('TaskUpdate', { taskId: '3', status: 'completed' })).toEqual({
      icon: 'clipboard-list',
      summary: 'completed: 3',
    })
    expect(getToolDisplay('TaskGet', { taskId: '5' })).toEqual({
      icon: 'clipboard-list',
      summary: '5',
    })
    expect(getToolDisplay('TaskList', {})).toEqual({
      icon: 'clipboard-list',
      summary: '',
    })
  })


  it('maps Grok-facing tools to icons and summaries', () => {
    expect(getToolDisplay('LS', { path: '/Users/demo/workspace/src' }, '/Users/demo/workspace', '/Users/demo')).toEqual({
      icon: 'folder-search',
      summary: 'src',
    })
    expect(getToolDisplay('ToolSearch', { query: 'github pr' })).toEqual({
      icon: 'toolbox',
      summary: 'github pr',
    })
    expect(getToolDisplay('SearchTools', { query: 'github pr' })).toEqual({
      icon: 'toolbox',
      summary: 'github pr',
    })
    expect(getToolDisplay('UseTool', { tool_name: 'GitHub__list_issues', server: 'GitHub' })).toEqual({
      icon: 'plug',
      summary: 'GitHub · GitHub__list_issues',
    })
    expect(getToolDisplay('MemorySearch', { query: 'auth decision' })).toEqual({
      icon: 'book-open',
      summary: 'auth decision',
    })
  })

  it('maps Workflow smoke-check to wrench + smoke-check summary', () => {
    expect(getToolDisplay('Workflow', { validate_only: true, name: 'mobile-adapt' })).toEqual({
      icon: 'wrench',
      summary: 'smoke-check · mobile-adapt',
    })
    expect(getToolDisplay('Workflow', {
      validate_only: true,
      script_path: '/Users/x/.grok/workflows/review-changes.rhai',
    })).toEqual({
      icon: 'wrench',
      summary: 'smoke-check · review-changes',
    })
    expect(getToolDisplay('Workflow', { validate_only: true })).toEqual({
      icon: 'wrench',
      summary: 'smoke-check',
    })
  })

  it('omits trailing colon when TaskUpdate has only status', () => {
    expect(getToolDisplay('TaskUpdate', { status: 'completed' })).toEqual({
      icon: 'clipboard-list',
      summary: 'completed',
    })
    expect(getToolDisplay('TaskUpdate', {})).toEqual({
      icon: 'clipboard-list',
      summary: 'update',
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

describe('getToolLabel', () => {
  it('uses descriptive labels for known tools', () => {
    expect(getToolLabel('LS')).toBe('List Dir')
    expect(getToolLabel('WebSearch')).toBe('Web Search')
    expect(getToolLabel('WebFetch')).toBe('Web Fetch')
    expect(getToolLabel('ToolSearch')).toBe('ToolSearch')
    expect(getToolLabel('SearchTools')).toBe('Search Tools')
    expect(getToolLabel('UseTool')).toBe('Use Tool')
    expect(getToolLabel('MemorySearch')).toBe('Memory Search')
    expect(getToolLabel('FileChange')).toBe('File Change')
  })

  it('splits unknown PascalCase names', () => {
    expect(getToolLabel('SomeCustomTool')).toBe('Some Custom Tool')
  })
})

