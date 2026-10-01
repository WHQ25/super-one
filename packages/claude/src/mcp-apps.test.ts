import { describe, expect, it, vi } from 'vitest'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'
import {
  CLAUDE_MCP_APPS_HOST_ENV,
  ClaudeMcpAppsCatalog,
  ClaudeToolApps,
  claudeMcpToolResult,
  normalizeClaudeMcpName,
  toMcpToolDescriptor,
  withMcpAppsHostEnv,
  type ClaudeMcpStatusServer,
} from './mcp-apps'

// Shapes as Claude Agent SDK 0.3.285 reports them for the MCP Apps fixture server.
const FIXTURE_STATUS: ClaudeMcpStatusServer = {
  name: 'my fixture',
  config: { type: 'stdio', command: 'node', args: ['fixture-server.ts', '--stdio'] },
  tools: [
    { name: 'fixture_list_items', annotations: { readOnly: true }, _meta: { ui: { resourceUri: 'ui://fixture/items.html' } } },
    { name: 'fixture_next_page', annotations: { readOnly: true }, _meta: { ui: { resourceUri: 'ui://fixture/items.html', visibility: ['app'] } } },
    { name: 'fixture_legacy_ui', annotations: {}, _meta: { 'ui/resourceUri': 'ui://fixture/legacy.html' } },
    { name: 'fixture_fail', annotations: {} },
  ],
}

const TOOL_USE_RESULT = {
  content: '{"items":["item-4","item-5","item-6"],"page":2,"pageCount":4}',
  _meta: { 'fixture/private': { token: 'private-2' } },
  structuredContent: { items: ['item-4', 'item-5', 'item-6'], page: 2, pageCount: 4 },
}

function binding(server: string): McpAppsBinding {
  return { node: 'local', session: 'sess-1', server, configGeneration: 0, configFingerprint: 'fp' }
}

function toolApps(overrides: Partial<ConstructorParameters<typeof ClaudeToolApps>[0]> = {}) {
  const catalog = new ClaudeMcpAppsCatalog()
  catalog.update([FIXTURE_STATUS])
  return new ClaudeToolApps({ catalog, binding, providerSessionId: () => 'claude-sid', ...overrides })
}

describe('withMcpAppsHostEnv', () => {
  it('starts from process.env when no env is set, because SDK env replaces the child env', () => {
    const env = withMcpAppsHostEnv(undefined)
    expect(env.PATH).toBe(process.env.PATH)
    expect(env[CLAUDE_MCP_APPS_HOST_ENV]).toBe('true')
  })

  it('keeps an explicit env as the base instead of re-adding process.env keys', () => {
    expect(withMcpAppsHostEnv({ ONLY: '1' })).toEqual({ ONLY: '1', [CLAUDE_MCP_APPS_HOST_ENV]: 'true' })
  })
})

describe('toMcpToolDescriptor', () => {
  it('restores MCP hint annotation names', () => {
    expect(toMcpToolDescriptor({ name: 't', annotations: { readOnly: true, destructive: false, openWorld: true } }).annotations)
      .toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true })
  })

  it('omits annotations the server did not declare, so approval treats them as unknown', () => {
    expect(toMcpToolDescriptor({ name: 't', annotations: {} }).annotations).toBeUndefined()
  })
})

describe('ClaudeMcpAppsCatalog', () => {
  it('resolves a qualified tool name back to the raw server name', () => {
    const catalog = new ClaudeMcpAppsCatalog()
    catalog.update([FIXTURE_STATUS])
    expect(catalog.resolve('mcp__my_fixture__fixture_list_items')?.server).toBe('my fixture')
    expect(catalog.resolve('mcp__my_fixture__missing')).toBeUndefined()
  })

  it('prefers the longest server prefix when normalized names overlap', () => {
    const catalog = new ClaudeMcpAppsCatalog()
    catalog.update([
      { name: 'a', tools: [{ name: 'b__run' }] },
      { name: 'a__b', tools: [{ name: 'run', _meta: { ui: { resourceUri: 'ui://x' } } }] },
    ])
    expect(catalog.resolve('mcp__a__b__run')?.server).toBe('a__b')
  })

  it('resolves tool names Claude normalized, back to the raw tool', () => {
    const catalog = new ClaudeMcpAppsCatalog()
    catalog.update([{ name: 'bits-and-bolts', tools: [{ name: 'cad.library', _meta: { ui: { resourceUri: 'ui://x' } } }] }])
    expect(catalog.resolve('mcp__bits-and-bolts__cad_library')?.tool.name).toBe('cad.library')
  })

  it('does not guess between raw tool names that normalize alike', () => {
    const catalog = new ClaudeMcpAppsCatalog()
    catalog.update([{ name: 's', tools: [{ name: 'a.b' }, { name: 'a_b' }] }])
    expect(catalog.resolve('mcp__s__a_b')).toBeUndefined()
  })
})

describe('normalizeClaudeMcpName', () => {
  it('replaces characters outside [a-zA-Z0-9_-] and collapses claude.ai connector names', () => {
    expect(normalizeClaudeMcpName('cad.library')).toBe('cad_library')
    expect(normalizeClaudeMcpName('my fixture')).toBe('my_fixture')
    expect(normalizeClaudeMcpName('claude.ai  Claude Docs.')).toBe('claude_ai_Claude_Docs')
  })
})

describe('claudeMcpToolResult', () => {
  it('turns the post-processed string content into a text block and keeps structured and private data', () => {
    expect(claudeMcpToolResult(TOOL_USE_RESULT, false)).toEqual({
      content: [{ type: 'text', text: TOOL_USE_RESULT.content }],
      structuredContent: TOOL_USE_RESULT.structuredContent,
      _meta: TOOL_USE_RESULT._meta,
    })
  })

  it('ignores tool_use_result shapes of built-in tools', () => {
    expect(claudeMcpToolResult({ stdout: 'x' }, false)).toBeUndefined()
  })

  it('falls back to the tool_result block inside a subagent, where only _meta survives', () => {
    const blocks = [{ type: 'text', text: '{"page":3}' }]
    expect(claudeMcpToolResult({ _meta: { token: 't' } }, false, blocks)).toEqual({ content: blocks, _meta: { token: 't' } })
    expect(claudeMcpToolResult({ _meta: {} }, true, 'boom')).toEqual({ content: [{ type: 'text', text: 'boom' }], _meta: {}, isError: true })
  })
})

describe('ClaudeToolApps', () => {
  it('attaches a pending app at tool_use and the full result at tool_result, keyed by tool_use id', () => {
    const apps = toolApps()
    const pending = apps.toolUse('toolu_1', 'mcp__my_fixture__fixture_list_items', { page: 2 })
    expect(pending).toMatchObject({
      appInstanceId: 'claude:sess-1:toolu_1',
      harnessCallId: 'toolu_1',
      origin: { providerSessionId: 'claude-sid' },
      resourceUri: 'ui://fixture/items.html',
      toolInput: { page: 2 },
      status: 'pending',
    })
    expect(pending?.binding.server).toBe('my fixture')

    const done = apps.toolResult('toolu_1', TOOL_USE_RESULT, false)
    expect(done).toMatchObject({ status: 'result', toolInput: { page: 2 }, toolResult: { structuredContent: TOOL_USE_RESULT.structuredContent } })
    expect(apps.toolResult('toolu_1', TOOL_USE_RESULT, false)).toBeUndefined()
  })

  it('reads the deprecated flat resource key', () => {
    expect(toolApps().toolUse('toolu_2', 'mcp__my_fixture__fixture_legacy_ui', {})?.resourceUri).toBe('ui://fixture/legacy.html')
  })

  it('attaches nothing to tools without a UI resource or outside MCP', () => {
    const apps = toolApps()
    expect(apps.toolUse('toolu_3', 'mcp__my_fixture__fixture_fail', {})).toBeUndefined()
    expect(apps.toolUse('toolu_4', 'Bash', { command: 'ls' })).toBeUndefined()
    expect(apps.toolResult('toolu_4', { stdout: '' }, false)).toBeUndefined()
  })

  it('marks an isError result as error while keeping the result for the View', () => {
    const apps = toolApps()
    apps.toolUse('toolu_5', 'mcp__my_fixture__fixture_list_items', {})
    expect(apps.toolResult('toolu_5', { content: 'boom' }, true)).toMatchObject({
      status: 'error',
      toolResult: { content: [{ type: 'text', text: 'boom' }], isError: true },
    })
  })

  it('resolves at tool_result when the catalog arrived after tool_use, and asks for a refresh on a miss', () => {
    const catalog = new ClaudeMcpAppsCatalog()
    const onCatalogMiss = vi.fn()
    const apps = new ClaudeToolApps({ catalog, binding, providerSessionId: () => null, onCatalogMiss })
    expect(apps.toolUse('toolu_6', 'mcp__my_fixture__fixture_list_items', { page: 1 })).toBeUndefined()
    expect(onCatalogMiss).toHaveBeenCalledTimes(1)
    catalog.update([FIXTURE_STATUS])
    expect(apps.toolResult('toolu_6', TOOL_USE_RESULT, false)).toMatchObject({ status: 'result', toolInput: { page: 1 } })
  })

  it('turns an oversized result into an error instead of truncating it', () => {
    const apps = toolApps()
    apps.toolUse('toolu_7', 'mcp__my_fixture__fixture_list_items', {})
    const huge = { content: 'x'.repeat(2 * 1024 * 1024) }
    expect(apps.toolResult('toolu_7', huge, false)).toMatchObject({ status: 'error', toolResult: undefined, error: { code: 'invalid' } })
  })
})
