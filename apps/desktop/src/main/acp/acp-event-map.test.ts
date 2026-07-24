import { describe, it, expect } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import {
  buildAcpPromptContentAsync,
  cancelOpenToolEvents,
  extractFileMentions,
  formatAcpRawOutput,
  mapSessionUpdate,
  mapStopReason,
  normalizeAcpTool,
  trackOpenTools,
} from './acp-event-map'

const ctx = { messageId: 'msg-1' }

function toolUseDelta(events: ReturnType<typeof mapSessionUpdate>) {
  const event = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_use')
  if (!event || event.type !== 'content_delta' || event.delta.type !== 'tool_use') {
    throw new Error('expected tool_use delta')
  }
  return event.delta
}

describe('normalizeAcpTool', () => {
  it('maps read kind to Read with file_path', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c1',
      title: 'Reading configuration file',
      kind: 'read',
      rawInput: { path: '/tmp/a.ts' },
      locations: [{ path: '/tmp/a.ts' }],
    })).toEqual({
      toolName: 'Read',
      input: { file_path: '/tmp/a.ts' },
      toolFilePath: '/tmp/a.ts',
      toolSummary: 'Reading configuration file',
    })
  })

  it('maps edit kind + diff content to Edit old/new strings', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c2',
      title: 'Updating config',
      kind: 'edit',
      content: [{
        type: 'diff',
        path: '/home/user/project/src/config.json',
        oldText: '{\n  "debug": false\n}',
        newText: '{\n  "debug": true\n}',
      }],
    })).toEqual({
      toolName: 'Edit',
      input: {
        file_path: '/home/user/project/src/config.json',
        old_string: '{\n  "debug": false\n}',
        new_string: '{\n  "debug": true\n}',
      },
      toolFilePath: '/home/user/project/src/config.json',
      toolSummary: 'Updating config',
    })
  })

  it('maps edit with only newText to Write', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c3',
      kind: 'edit',
      rawInput: { path: '/tmp/new.ts' },
      content: [{
        type: 'diff',
        path: '/tmp/new.ts',
        oldText: null,
        newText: 'export const x = 1\n',
      }],
    })).toMatchObject({
      toolName: 'Write',
      input: {
        file_path: '/tmp/new.ts',
        content: 'export const x = 1\n',
      },
    })
  })

  it('maps delete kind to Edit with empty new_string', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c4',
      kind: 'delete',
      rawInput: { path: '/tmp/gone.ts', oldText: 'bye' },
    })).toMatchObject({
      toolName: 'Edit',
      input: {
        file_path: '/tmp/gone.ts',
        old_string: 'bye',
        new_string: '',
      },
    })
  })

  it('maps execute kind to Bash command', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c5',
      kind: 'execute',
      title: 'List files',
      rawInput: { command: 'ls -la' },
    })).toEqual({
      toolName: 'Bash',
      input: { command: 'ls -la' },
      toolFilePath: undefined,
      toolSummary: 'List files',
    })
  })

  it('maps search kind to Grep or Glob', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c6',
      kind: 'search',
      rawInput: { pattern: 'TODO', path: 'src' },
    })).toMatchObject({
      toolName: 'Grep',
      input: { pattern: 'TODO', path: 'src' },
    })

    expect(normalizeAcpTool({
      toolCallId: 'c7',
      kind: 'search',
      rawInput: { glob: '**/*.ts' },
    })).toMatchObject({
      toolName: 'Glob',
      input: { pattern: '**/*.ts' },
    })
  })

  it('maps fetch kind to WebFetch or WebSearch', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c8',
      kind: 'fetch',
      rawInput: { url: 'https://example.com' },
    })).toMatchObject({
      toolName: 'WebFetch',
      input: { url: 'https://example.com' },
    })

    expect(normalizeAcpTool({
      toolCallId: 'c9',
      kind: 'fetch',
      rawInput: { query: 'agent client protocol' },
    })).toMatchObject({
      toolName: 'WebSearch',
      input: { query: 'agent client protocol' },
    })
  })

  it('falls back to title when kind is other', () => {
    expect(normalizeAcpTool({
      toolCallId: 'c10',
      kind: 'other',
      title: 'Custom action',
      rawInput: { foo: 1 },
    })).toMatchObject({
      toolName: 'Custom action',
      input: { foo: 1 },
    })
  })
})

describe('mapSessionUpdate', () => {
  it('maps agent_message_chunk text to content_delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'content_delta',
      messageId: 'msg-1',
      delta: { type: 'text', text: 'Hello' },
    }])
  })

  it('maps agent_thought_chunk to thinking delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'reasoning…' },
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'thinking', thinking: 'reasoning…' },
    })
  })

  it('maps tool_call to Claude-shaped tool_use', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
      rawInput: { path: '/tmp/a.ts' },
      locations: [{ path: '/tmp/a.ts' }],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toHaveLength(1)
    const delta = toolUseDelta(events)
    expect(delta).toMatchObject({
      type: 'tool_use',
      toolUseId: 'call_1',
      toolName: 'Read',
      status: 'streaming',
      toolFilePath: '/tmp/a.ts',
      toolSummary: 'Read file',
    })
    expect(JSON.parse(delta.input as string)).toEqual({ file_path: '/tmp/a.ts' })
  })

  it('maps completed edit tool_call_update with diff into Edit tool_use + result', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_edit',
      kind: 'edit',
      status: 'completed',
      content: [{
        type: 'diff',
        path: '/tmp/a.ts',
        oldText: 'a',
        newText: 'b',
      }],
    }
    const events = mapSessionUpdate(update, ctx)
    const use = toolUseDelta(events)
    expect(use.toolName).toBe('Edit')
    expect(use.status).toBe('complete')
    expect(JSON.parse(use.input as string)).toEqual({
      file_path: '/tmp/a.ts',
      old_string: 'a',
      new_string: 'b',
    })
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'call_edit',
        isError: false,
      },
    })
  })

  it('maps completed tool_call_update to tool_result', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_1',
      status: 'completed',
      content: [{
        type: 'content',
        content: { type: 'text', text: 'file body' },
      }],
    }
    const events = mapSessionUpdate(update, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'call_1',
        summary: 'file body',
        isError: false,
      },
    })
  })

  it('maps execute tool_call to Bash', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_bash',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { cmd: 'pwd' },
    }
    const delta = toolUseDelta(mapSessionUpdate(update, ctx))
    expect(delta.toolName).toBe('Bash')
    expect(JSON.parse(delta.input as string)).toEqual({ command: 'pwd' })
  })

  it('maps plan entries to hidden TodoWrite tool_use + tool_result', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Explore', priority: 'high', status: 'completed' },
        { content: 'Implement', priority: 'medium', status: 'in_progress' },
      ],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toHaveLength(2)
    const use = toolUseDelta(events)
    expect(use.toolName).toBe('TodoWrite')
    expect(use.toolUseId).toBe('acp-plan:msg-1')
    const todos = JSON.parse(use.input as string).todos
    expect(todos).toEqual([
      { content: 'Explore', status: 'completed' },
      { content: 'Implement', status: 'in_progress', activeForm: 'Implement' },
    ])
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', toolUseId: 'acp-plan:msg-1', isError: false },
    })
  })

  it('binds embedded terminal and maps execute to Bash with command', () => {
    const binds: Array<[string, string]> = []
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_term',
      kind: 'execute',
      status: 'in_progress',
      title: 'Run tests',
      content: [{ type: 'terminal', terminalId: 'term_1' }],
    }
    const delta = toolUseDelta(mapSessionUpdate(update, ctx, {
      resolveTerminalCommand: (id) => id === 'term_1' ? 'npm test' : undefined,
      onTerminalEmbedded: (tid, tuid) => binds.push([tid, tuid]),
    }))
    expect(binds).toEqual([['term_1', 'call_term']])
    expect(delta.toolName).toBe('Bash')
    expect(JSON.parse(delta.input as string)).toEqual({ command: 'npm test' })
  })

  it('buildAcpPromptContent includes text and images', async () => {
    const { buildAcpPromptContent } = await import('./acp-event-map')
    expect(buildAcpPromptContent('hi', [{ mimeType: 'image/png', base64: 'abc', name: 'a.png' }])).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', mimeType: 'image/png', data: 'abc', uri: 'attachment://a.png' },
    ])
  })

  it('maps available_commands_update to acp_commands', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'web', description: 'Search the web', input: { hint: 'query' } },
        { name: '/plan', description: 'Make a plan' },
        { name: '', description: 'skip empty' },
      ],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'acp_commands',
      commands: [
        { name: 'web', description: 'Search the web', argumentHint: 'query', isSkill: false },
        { name: 'plan', description: 'Make a plan', argumentHint: '', isSkill: false },
      ],
    }])
  })

  it('hides /always-approve from acp slash commands (host permission selector owns it)', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'compact', description: 'Compact context' },
        { name: 'always-approve', description: 'Skip permission prompts' },
        { name: '/always-approve', description: 'with slash prefix' },
        { name: 'context', description: 'Show context' },
      ],
    }
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'acp_commands',
      commands: [
        { name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false },
        { name: 'context', description: 'Show context', argumentHint: '', isSkill: false },
      ],
    }])
  })

  it('ignores unknown update kinds', () => {
    const update = {
      sessionUpdate: 'session_info_update',
      title: 'x',
    } as SessionUpdate
    expect(mapSessionUpdate(update, ctx)).toEqual([])
  })
})

describe('mapStopReason', () => {
  it('marks cancelled as interrupted', () => {
    expect(mapStopReason('cancelled')).toEqual({ complete: false, interrupted: true })
  })

  it('marks end_turn as complete', () => {
    expect(mapStopReason('end_turn')).toEqual({ complete: true, interrupted: false })
  })
})

describe('usage_update and cancel helpers', () => {
  it('maps usage_update to message_usage with context tokens', () => {
    const update = {
      sessionUpdate: 'usage_update',
      used: 53000,
      size: 200000,
      cost: { amount: 0.045, currency: 'USD' },
    } as never
    const events = mapSessionUpdate(update, ctx)
    expect(events).toEqual([{
      type: 'message_usage',
      messageId: 'msg-1',
      inputTokens: 53000,
      outputTokens: 0,
      contextTokens: 53000,
      contextWindow: 200000,
      costUsd: 0.045,
    }])
  })

  it('trackOpenTools + cancelOpenToolEvents closes open tools', () => {
    const open = new Set<string>()
    const toolEvents = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: '/a' },
    } as never, ctx)
    trackOpenTools(open, toolEvents)
    expect(open.has('c1')).toBe(true)
    const cancelled = cancelOpenToolEvents('msg-1', open)
    expect(open.size).toBe(0)
    expect(cancelled.some((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')).toBe(true)
  })

  it('extractFileMentions finds path-like mentions', () => {
    expect(extractFileMentions('see @src/main.ts and @agent')).toEqual(['src/main.ts'])
  })

  it('buildAcpPromptContentAsync embeds file resources', async () => {
    const blocks = await buildAcpPromptContentAsync('please read @foo.ts', {
      cwd: '/proj',
      readFile: async (abs) => abs.endsWith('foo.ts') ? 'export const x = 1' : null,
    })
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'please read @foo.ts' })
    expect(blocks.some((b) => b.type === 'resource')).toBe(true)
    const res = blocks.find((b) => b.type === 'resource') as { resource: { text: string } }
    expect(res.resource.text).toBe('export const x = 1')
  })
})

describe('tool mapping from real ACP agent traces', () => {
  it('maps list_dir title to LS and does not wipe name on sparse complete', () => {
    const start = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_list',
      title: 'list_dir',
      status: 'pending',
      rawInput: { target_directory: '/proj' },
    } as never, ctx)
    expect(toolUseDelta(start).toolName).toBe('LS')
    expect(JSON.parse(toolUseDelta(start).input as string)).toEqual({ path: '/proj' })

    const mid = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_list',
      title: 'List `/proj`',
      kind: 'other',
      status: 'in_progress',
      rawInput: { variant: 'ListDir', target_directory: '/proj' },
      locations: [{ path: '/proj' }],
    } as never, ctx)
    expect(toolUseDelta(mid).toolName).toBe('LS')

    const done = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_list',
      status: 'completed',
      rawOutput: { type: 'ListDir', Content: { content: '- /proj\\n' } },
    } as never, ctx)
    // Sparse complete: no tool_use overwrite
    expect(done.every((e) => !(e.type === 'content_delta' && e.delta.type === 'tool_use'))).toBe(true)
    const result = done.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toBeTruthy()
  })

  it('keeps Grep when rawInput has pattern + glob filter', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_grep',
      title: 'grep',
      kind: 'search',
      rawInput: { pattern: 'kimi', glob: '*.ts', head_limit: 50 },
    } as never, ctx)
    expect(toolUseDelta(events).toolName).toBe('Grep')
    expect(JSON.parse(toolUseDelta(events).input as string)).toMatchObject({
      pattern: 'kimi',
      glob: '*.ts',
      head_limit: 50,
    })
  })

  it('maps WebSearch variant under search kind to WebSearch not Grep', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_ws',
      title: 'Web search:',
      kind: 'search',
      rawInput: { variant: 'WebSearch', backend: true },
    } as never, ctx)
    expect(toolUseDelta(events).toolName).toBe('WebSearch')
  })

  it('maps read_file / run_terminal_command / search_replace / web_fetch tool ids', () => {
    expect(toolUseDelta(mapSessionUpdate({
      sessionUpdate: 'tool_call', toolCallId: 'a', title: 'read_file',
      rawInput: { target_file: '/a.ts' },
    } as never, ctx)).toolName).toBe('Read')

    expect(toolUseDelta(mapSessionUpdate({
      sessionUpdate: 'tool_call', toolCallId: 'b', title: 'run_terminal_command',
      kind: 'execute', rawInput: { command: 'ls' },
    } as never, ctx)).toolName).toBe('Bash')

    expect(toolUseDelta(mapSessionUpdate({
      sessionUpdate: 'tool_call', toolCallId: 'c', title: 'search_replace',
      kind: 'edit', rawInput: { file_path: '/a.ts', old_string: 'a', new_string: 'b' },
    } as never, ctx)).toolName).toBe('Edit')

    expect(toolUseDelta(mapSessionUpdate({
      sessionUpdate: 'tool_call', toolCallId: 'd', title: 'web_fetch',
      kind: 'fetch', rawInput: { url: 'https://example.com' },
    } as never, ctx)).toolName).toBe('WebFetch')
  })
})

describe('formatAcpRawOutput', () => {
  it('unwraps the MCP result envelope to the tool payload', () => {
    // Real grok shape: the variant key (OkayOutput) is a serde tag around the payload.
    expect(formatAcpRawOutput({
      type: 'MCP',
      tool_name: 'widget_read_guide',
      server_name: 'superone',
      output: { OkayOutput: '# Widget — Visual creation suite' },
    })).toBe('# Widget — Visual creation suite')
  })

  it('unwraps an MCP error variant without knowing its tag name', () => {
    expect(formatAcpRawOutput({
      type: 'MCP',
      tool_name: 'widget_show',
      server_name: 'superone',
      output: { ErrorOutput: 'tool execution failed' },
    })).toBe('tool execution failed')
  })

  it('unwraps ListDir Content.content tree', () => {
    const tree = '- /proj/node_modules/@opencode-ai/models/\n  - dist/\n    - client.d.ts\n  - package.json\n'
    expect(formatAcpRawOutput({
      type: 'ListDir',
      Content: {
        content: tree,
        absolute_root_path: '/proj/node_modules/@opencode-ai/models',
      },
    })).toBe(tree)
  })

  it('maps completed ListDir tool_call_update summary to tree not JSON', () => {
    const tree = '- /tmp/a/\n  - b.ts\n'
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_ls',
      status: 'completed',
      rawOutput: {
        type: 'ListDir',
        Content: { content: tree, absolute_root_path: '/tmp/a' },
      },
    } as never, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', summary: tree, isError: false },
    })
  })


  it('unwraps ListDir JSON even when delivered as content text (not only rawOutput)', () => {
    const tree = '- /tmp/a/\n  - b.ts\n'
    const envelope = JSON.stringify({
      type: 'ListDir',
      Content: { content: tree, absolute_root_path: '/tmp/a' },
    })
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_ls2',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: envelope } }],
    } as never, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', summary: tree },
    })
  })

  it('unwraps Todo TodosUpdated.summary_for_prompt', () => {
    expect(formatAcpRawOutput({
      type: 'Todo',
      TodosUpdated: { summary_for_prompt: '- [x] done\n- [ ] next' },
    })).toBe('- [x] done\n- [ ] next')
  })

  it('keeps widget_show MCP payload compact and untruncated past 4k', () => {
    const widgetPayload = JSON.stringify({
      title: 'mortgage_calculator',
      widget_code: `<div class="w">${'x'.repeat(5000)}</div>`,
      width: 720,
      height: 720,
      isSVG: false,
    })
    expect(widgetPayload.length).toBeGreaterThan(4000)
    expect(formatAcpRawOutput({
      type: 'MCP',
      tool_name: 'widget_show',
      server_name: 'superone',
      output: { OkayOutput: widgetPayload },
    })).toBe(widgetPayload)

    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_widget',
      status: 'completed',
      rawOutput: {
        type: 'MCP',
        tool_name: 'widget_show',
        server_name: 'superone',
        output: { OkayOutput: widgetPayload },
      },
    } as never, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', summary: widgetPayload, isError: false },
    })
    expect(JSON.parse((result as { delta: { summary: string } }).delta.summary).widget_code.length).toBeGreaterThan(4000)
  })

  it('does not pretty-print opaque JSON when re-formatting a string payload', () => {
    const compact = '{"title":"w","widget_code":"<div/>","width":1,"height":1,"isSVG":false}'
    expect(formatAcpRawOutput(compact)).toBe(compact)
  })
})

describe('Grok Build tool meta mapping', () => {
  it('maps search_tool / SearchTool to SearchTools with query summary input', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_st',
      title: 'search_tool',
      rawInput: { query: 'github pull request comment list', limit: 10 },
      _meta: {
        'x.ai/tool': {
          version: 1,
          name: 'search_tool',
          kind: 'search_tool',
          namespace: 'grok_build',
          label: 'Search Tools',
          read_only: true,
        },
      },
    } as never, ctx)
    expect(toolUseDelta(events).toolName).toBe('SearchTools')
    expect(JSON.parse(toolUseDelta(events).input as string)).toMatchObject({
      query: 'github pull request comment list',
      limit: 10,
    })
  })

  it('maps list_dir via _meta even when title is human List path', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_ls_meta',
      kind: 'other',
      title: 'List `/proj`',
      rawInput: { variant: 'ListDir', target_directory: '/proj' },
      _meta: {
        'x.ai/tool': { name: 'list_dir', kind: 'list', namespace: 'grok_build', label: 'List Files' },
      },
    } as never, ctx)
    expect(toolUseDelta(events).toolName).toBe('LS')
  })
})

// Grok routes every MCP call through a generic `use_tool` envelope; payloads below are
// verbatim from an event-trace recording of a real grok-build session.
describe('Grok use_tool MCP envelope', () => {
  const useToolMeta = {
    'x.ai/tool': {
      version: 1,
      name: 'use_tool',
      kind: 'use_tool',
      namespace: 'grok_build',
      label: 'Use Tool',
      read_only: false,
    },
  }

  it('unwraps tool_call to the canonical mcp__server__tool name the UI parses', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-x-2',
      title: 'use_tool',
      rawInput: {
        tool_name: 'superone__session_rename',
        tool_input: { title: '测试房贷计算器 Widget' },
      },
      _meta: useToolMeta,
    } as never, ctx)
    const delta = toolUseDelta(events)
    expect(delta.toolName).toBe('mcp__superone__session_rename')
    // The envelope must be peeled off the input too — not surfaced as tool_name/tool_input.
    expect(JSON.parse(delta.input as string)).toEqual({ title: '测试房贷计算器 Widget' })
  })

  it('unwraps tool_call_update, where title already carries the combined tool id', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-x-4',
      kind: 'other',
      title: 'superone__widget_show',
      rawInput: {
        variant: 'UseTool',
        tool_name: 'superone__widget_show',
        tool_input: { title: 'mortgage_calculator', widget_code: '<div/>' },
      },
      _meta: useToolMeta,
    } as never, ctx)
    const delta = toolUseDelta(events)
    expect(delta.toolName).toBe('mcp__superone__widget_show')
    expect(JSON.parse(delta.input as string)).toMatchObject({ title: 'mortgage_calculator' })
  })

  it('keeps grok native tools out of the envelope path', () => {
    expect(normalizeAcpTool({
      toolCallId: 'call-native',
      title: 'run_terminal_command',
      rawInput: { command: 'echo hi', description: 'probe' },
      _meta: {
        'x.ai/tool': { name: 'run_terminal_command', kind: 'execute', namespace: 'grok_build' },
      },
    } as never)?.toolName).toBe('Bash')
  })

  it('leaves a use_tool envelope alone when the tool id carries no server prefix', () => {
    // Nothing to build `mcp__<server>__<tool>` from — must not fabricate a name.
    expect(normalizeAcpTool({
      toolCallId: 'call-bare',
      title: 'use_tool',
      rawInput: { tool_name: 'localthing', tool_input: {} },
      _meta: useToolMeta,
    } as never)?.toolName).toBe('UseTool')
  })
})

describe('Grok full tool set mapping', () => {
  const grokMeta = (name: string, kind: string, label: string) => ({
    'x.ai/tool': { version: 1, name, kind, namespace: 'grok_build', label, read_only: true },
  })

  it.each([
    ['read_file', 'read', 'Read', { target_file: '/a.ts' }, 'Read'],
    ['search_replace', 'edit', 'Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }, 'Edit'],
    ['grep', 'search', 'Search', { pattern: 'foo', path: '/proj' }, 'Grep'],
    ['list_dir', 'list', 'List Files', { target_directory: '/proj' }, 'LS'],
    ['run_terminal_command', 'execute', 'Run Command', { command: 'pwd' }, 'Bash'],
    ['web_search', 'fetch', 'Web Search', { query: 'xai' }, 'WebSearch'],
    ['web_fetch', 'fetch', 'Web Fetch', { url: 'https://x.ai' }, 'WebFetch'],
    ['todo_write', 'other', 'Todo', { todos: [] }, 'TodoWrite'],
    ['search_tool', 'search_tool', 'Search Tools', { query: 'github issue' }, 'SearchTools'],
    ['use_tool', 'other', 'Use Tool', { tool_name: 'GitHub__list_issues' }, 'mcp__GitHub__list_issues'],
    ['spawn_subagent', 'other', 'Spawn', { description: 'explore' }, 'Task'],
    ['memory_search', 'search', 'Memory', { query: 'prior decision' }, 'MemorySearch'],
    ['ask_user_question', 'ask_user', 'Ask User', { questions: [{ question: 'Pick?', options: [{ label: 'A' }] }] }, 'AskUserQuestion'],
    ['get_command_or_subagent_output', 'other', 'Task Output', { task_ids: ['t1'], timeout_ms: 60000 }, 'TaskOutput'],
    ['get_task_output', 'other', 'Task Output', { task_id: 't2' }, 'TaskOutput'],
    ['kill_task', 'other', 'Kill', { task_id: 't3' }, 'KillTask'],
    ['enter_plan_mode', 'other', 'Plan', {}, 'EnterPlanMode'],
    ['exit_plan_mode', 'other', 'Exit Plan', {}, 'ExitPlanMode'],
    ['open_page', 'fetch', 'Open Page', { url: 'https://x.ai' }, 'WebFetch'],
    ['skill', 'other', 'Skill', { skill: 'help' }, 'Skill'],
    ['image_gen', 'other', 'Image', { prompt: 'cat' }, 'ImageGen'],
    ['monitor', 'other', 'Monitor', { description: 'watch logs' }, 'Monitor'],
    ['update_goal', 'other', 'Goal', { message: 'done' }, 'UpdateGoal'],
  ] as const)('maps grok %s → %s', (name, kind, label, rawInput, expected) => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: `c_${name}`,
      title: name,
      kind,
      rawInput,
      _meta: grokMeta(name, kind, label),
    } as never, ctx)
    expect(toolUseDelta(events).toolName).toBe(expected)
  })

  it('normalizes TaskOutput task_ids into task_id summary field', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c_to',
      title: 'get_command_or_subagent_output',
      kind: 'other',
      rawInput: { variant: 'TaskOutput', task_ids: ['abc-1', 'abc-2'], timeout_ms: 120000 },
      _meta: grokMeta('get_command_or_subagent_output', 'other', 'Task Output'),
    } as never, ctx)
    const delta = toolUseDelta(events)
    expect(delta.toolName).toBe('TaskOutput')
    expect(JSON.parse(delta.input as string)).toMatchObject({
      task_id: 'abc-1',
      task_ids: ['abc-1', 'abc-2'],
      timeout_ms: 120000,
    })
  })

  it('maps ask_user_question with questions payload', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c_ask',
      title: 'ask_user_question',
      kind: 'ask_user',
      rawInput: {
        questions: [{
          question: 'Which approach?',
          options: [
            { label: 'A', description: 'first' },
            { label: 'B', description: 'second' },
          ],
        }],
      },
      _meta: grokMeta('ask_user_question', 'ask_user', 'Ask User'),
    } as never, ctx)
    const delta = toolUseDelta(events)
    expect(delta.toolName).toBe('AskUserQuestion')
    const input = JSON.parse(delta.input as string)
    expect(input.questions).toHaveLength(1)
    expect(input.questions[0].question).toBe('Which approach?')
  })

  it('formats SearchTool result as readable tool catalog', () => {
    const payload = {
      results: [
        {
          server: 'GitHub',
          tools: [
            { tool_name: 'GitHub__get_pull_request_comments', description: 'Get PR comments', score: 7.3 },
          ],
        },
      ],
      note: 'more tools hidden',
    }
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c_st',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(payload) } }],
      rawOutput: { type: 'SearchTool', result_count: 1, content: JSON.stringify(payload) },
    } as never, ctx)
    const result = events.find((e) => e.type === 'content_delta' && e.delta.type === 'tool_result')
    expect(result?.type).toBe('content_delta')
    if (result?.type === 'content_delta' && result.delta.type === 'tool_result') {
      expect(result.delta.summary).toContain('Found 1 tool')
      expect(result.delta.summary).toContain('[GitHub]')
      expect(result.delta.summary).toContain('GitHub__get_pull_request_comments')
      expect(result.delta.summary).not.toContain('input_schema')
    }
  })
})

