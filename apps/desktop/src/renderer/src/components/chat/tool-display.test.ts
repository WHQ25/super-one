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

describe('getToolDisplay: Artifact', () => {
  it('summarizes a publish by title only — the local path belongs in the expanded result', () => {
    expect(getToolDisplay('Artifact', { file_path: '/repo/report.html', title: 'Q3 Report' }, '/repo').summary).toBe('Q3 Report')
    expect(getToolDisplay('Artifact', { file_path: '/repo/report.html' }, '/repo').summary).toBe('')
  })

  it('names each asset sub-action, and nothing else — identity comes from the link chip', () => {
    expect(getToolDisplay('Artifact', { action: 'upload_asset', url: 'https://x/y', file_path: '/repo/logo.png' }, '/repo').summary)
      .toBe('upload asset')
    expect(getToolDisplay('Artifact', { action: 'list_assets', url: 'https://x/y' }).summary).toBe('list assets')
    expect(getToolDisplay('Artifact', { action: 'read_asset', asset_id: 'abc123' }).summary).toBe('read asset')
    expect(getToolDisplay('Artifact', { action: 'delete_asset', asset_id: 'abc123' }).summary).toBe('delete asset')
    expect(getToolDisplay('Artifact', { action: 'list', scope: 'all' }).summary).toBe('list · all')
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
  it('hides harness tool-search aliases', () => {
    for (const name of ['ToolSearch', 'SearchTools', 'SearchTool', 'tool_search', 'search_tool']) {
      expect(isAlwaysHiddenToolBlock(name)).toBe(true)
    }
  })

  it('hides Grok wire names and the use_tool envelope before they refine', () => {
    expect(isAlwaysHiddenToolBlock('todo_write')).toBe(true)
    expect(isAlwaysHiddenToolBlock('use_tool')).toBe(true)
    expect(isAlwaysHiddenToolBlock('UseTool')).toBe(true)
  })

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

  it('still hides session rename, tag-list, and agent-list meta tools', () => {
    expect(isAlwaysHiddenToolBlock('mcp__superone__session_rename')).toBe(true)
    expect(isAlwaysHiddenToolBlock('mcp__superone__session_tag_list')).toBe(true)
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

    expect(getToolDisplay('Delete', { file_path: '/Users/demo/workspace/gone.ts' }, '/Users/demo/workspace', '/Users/demo')).toEqual({
      icon: 'file-edit',
      summary: 'gone.ts',
    })

    expect(getToolDisplay('SemanticSearch', { query: 'auth flow' })).toEqual({
      icon: 'search',
      summary: 'auth flow',
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

describe('getToolDisplay for device tools', () => {
  it('summarises a control request with the device and the agent\'s reason', () => {
    // device_request_control has no bespoke prompt component — this summary is the
    // only thing telling the user which device they are about to hand over.
    expect(getToolDisplay('mcp__superone__device_request_control', {
      device: 'iPhone 17 Pro Max',
      platform: 'iOS 26.4',
      description: 'Drive the dev build',
    })).toEqual({
      icon: 'smartphone',
      // The runtime is not decoration: this machine has the same model on five of
      // them, so the name alone asks the user to approve blind.
      summary: 'iPhone 17 Pro Max · iOS 26.4 · Drive the dev build',
    })
  })

  it('stays quiet while the input is still streaming in', () => {
    expect(getToolDisplay('mcp__superone__device_snapshot', {}))
      .toEqual({ icon: 'smartphone', summary: '' })
  })

  it('leaves a third-party device_* tool on the generic MCP row', () => {
    expect(getToolDisplay('mcp__other__device_request_control', { device: 'x' }))
      .toEqual({ icon: 'plug', summary: '' })
  })
})
