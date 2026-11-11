import { describe, expect, it } from 'vitest'
import {
  filterMcpAppEntrypointsForContext,
  hasMcpAppEntrypoint,
  mcpAppEntrypointKey,
  mcpAppEntrypointKinds,
  mcpAppStandaloneSessionId,
  mcpAppThreadEntrypointKey,
  parseMcpAppEntrypointKey,
  parseMcpAppStandaloneSessionId,
  toMcpAppEntrypointDescriptor,
} from './mcp-app-entrypoints'
import type { McpToolDescriptor } from './mcp-apps'

describe('mcp-app-entrypoints shared contracts', () => {
  it('parses global and thread entrypoints on ui:// tools regardless of model visibility', () => {
    const appOnly: McpToolDescriptor = {
      name: 'open_board',
      title: 'Kanban Board',
      description: 'Interactive sprint board\nIgnored second line',
      icons: [{ src: 'https://icons.example/board.png' }],
      serverInfo: { name: 'linear', title: 'Linear' },
      _meta: {
        ui: { resourceUri: 'ui://linear/board.html', visibility: ['app'] },
        'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }, { type: 'file', extensions: ['.json'] }] },
      },
    }
    expect(mcpAppEntrypointKinds(appOnly)).toEqual(['global', 'thread'])
    expect(hasMcpAppEntrypoint(appOnly, 'global')).toBe(true)
    expect(hasMcpAppEntrypoint(appOnly, 'thread')).toBe(true)

    const descriptor = toMcpAppEntrypointDescriptor({ server: 'linear', tool: appOnly, harness: 'claude' })
    expect(descriptor).toEqual({
      key: mcpAppEntrypointKey('claude', 'linear', 'open_board'),
      server: 'linear',
      tool: 'open_board',
      title: 'Kanban Board',
      serverTitle: 'Linear',
      description: 'Interactive sprint board',
      icon: 'https://icons.example/board.png',
      icons: [{ src: 'https://icons.example/board.png' }],
      resourceUri: 'ui://linear/board.html',
      harness: 'claude',
      kinds: ['global', 'thread'],
    })
  })

  it('extracts OpenAI quickAction title and icons when tool-level metadata is absent', () => {
    const cadTool: McpToolDescriptor = {
      name: 'cad.library',
      serverInfo: { name: 'bits', title: 'Bits & Bolts' },
      _meta: {
        ui: { resourceUri: 'ui://bits/library.html' },
        'openai/ui': {
          entrypoints: [
            {
              type: 'global',
              quickAction: {
                title: '3D CAD Library',
                icons: [{ src: 'https://icons.example/cad-dark.png', theme: 'dark' }],
              },
            },
          ],
        },
      },
    }
    const descriptor = toMcpAppEntrypointDescriptor({ server: 'bits', tool: cadTool, harness: 'codex' })
    expect(descriptor).toMatchObject({
      title: '3D CAD Library',
      serverTitle: 'Bits & Bolts',
      icon: 'https://icons.example/cad-dark.png',
      icons: [{ src: 'https://icons.example/cad-dark.png', theme: 'dark' }],
      kinds: ['global'],
    })
  })

  it('filters entrypoints by active session and selected harness', () => {
    const claudeGlobal = toMcpAppEntrypointDescriptor({
      server: 'linear',
      harness: 'claude',
      tool: {
        name: 'open_board',
        title: 'Linear Board',
        _meta: { ui: { resourceUri: 'ui://linear/board.html', entrypoints: [{ type: 'global' }] } },
      },
    })!
    const claudeThreadSameTool = toMcpAppEntrypointDescriptor({
      server: 'linear',
      harness: 'claude',
      tool: {
        name: 'open_board',
        title: 'Linear Board',
        _meta: { ui: { resourceUri: 'ui://linear/board.html', entrypoints: [{ type: 'thread' }] } },
      },
    })!
    const claudeThreadOnly = toMcpAppEntrypointDescriptor({
      server: 'postgres',
      harness: 'claude',
      tool: {
        name: 'query_studio',
        title: 'Query Studio',
        _meta: { ui: { resourceUri: 'ui://pg/studio.html' }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
      },
    })!
    const codexGlobal = toMcpAppEntrypointDescriptor({
      server: 'cad',
      harness: 'codex',
      tool: {
        name: 'open_cad',
        title: 'CAD Studio',
        _meta: { ui: { resourceUri: 'ui://cad/studio.html' }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
      },
    })!
    const codexThreadOnly = toMcpAppEntrypointDescriptor({
      server: 'cad',
      harness: 'codex',
      tool: {
        name: 'inspect_mesh',
        title: 'Mesh Inspector',
        _meta: { ui: { resourceUri: 'ui://cad/mesh.html' }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
      },
    })!

    const all = [claudeGlobal, claudeThreadSameTool, claudeThreadOnly, codexGlobal, codexThreadOnly]

    const inClaudeSession = filterMcpAppEntrypointsForContext(all, {
      hasSession: true,
      provider: 'claude',
    })
    expect(inClaudeSession.map(e => ({ title: e.title, kinds: e.kinds }))).toEqual([
      { title: 'Linear Board', kinds: ['global', 'thread'] },
      { title: 'Query Studio', kinds: ['thread'] },
    ])

    const inCodexSession = filterMcpAppEntrypointsForContext(all, {
      hasSession: true,
      provider: 'codex',
    })
    expect(inCodexSession.map(e => ({ title: e.title, kinds: e.kinds }))).toEqual([
      { title: 'CAD Studio', kinds: ['global'] },
      { title: 'Mesh Inspector', kinds: ['thread'] },
    ])

    expect(filterMcpAppEntrypointsForContext(all, { hasSession: true, provider: 'opencode' })).toEqual([])
    expect(filterMcpAppEntrypointsForContext(all, { hasSession: true, provider: 'acp' })).toEqual([])

    const withoutSession = filterMcpAppEntrypointsForContext(all, { hasSession: false })
    expect(withoutSession.map(e => e.title)).toEqual(['CAD Studio', 'Linear Board'])
  })

  it('collapses separate global and thread tools sharing (server, resourceUri, title) based on draft vs active thread', () => {
    const cadLibrary = toMcpAppEntrypointDescriptor({
      server: 'bits-and-bolts',
      harness: 'codex',
      tool: {
        name: 'cad.library',
        title: 'Bits & Bolts',
        description: 'Browse the CAD catalog and inspect a part.',
        _meta: {
          ui: { resourceUri: 'ui://bits-and-bolts/app-v14' },
          'openai/ui': { entrypoints: [{ type: 'global' }] },
        },
      },
    })!
    const cadTray = toMcpAppEntrypointDescriptor({
      server: 'bits-and-bolts',
      harness: 'codex',
      tool: {
        name: 'cad.tray',
        title: 'Bits & Bolts',
        description: 'Open the parts library beside this conversation.',
        _meta: {
          ui: { resourceUri: 'ui://bits-and-bolts/app-v14' },
          'openai/ui': { entrypoints: [{ type: 'thread' }] },
        },
      },
    })!
    const distinctTitleSameResource = toMcpAppEntrypointDescriptor({
      server: 'bits-and-bolts',
      harness: 'codex',
      tool: {
        name: 'cad.settings',
        title: 'CAD Units',
        _meta: {
          ui: { resourceUri: 'ui://bits-and-bolts/app-v14' },
          'openai/ui': { entrypoints: [{ type: 'thread' }] },
        },
      },
    })!

    const onEmptyDraft = filterMcpAppEntrypointsForContext(
      [cadLibrary, cadTray, distinctTitleSameResource],
      { hasSession: true, provider: 'codex', isEmptyDraft: true },
    )
    expect(onEmptyDraft.map(e => ({ tool: e.tool, title: e.title }))).toEqual([
      { tool: 'cad.library', title: 'Bits & Bolts' },
      { tool: 'cad.settings', title: 'CAD Units' },
    ])

    const onActiveThread = filterMcpAppEntrypointsForContext(
      [cadLibrary, cadTray, distinctTitleSameResource],
      { hasSession: true, provider: 'codex', isEmptyDraft: false },
    )
    expect(onActiveThread.map(e => ({ tool: e.tool, title: e.title }))).toEqual([
      { tool: 'cad.tray', title: 'Bits & Bolts' },
      { tool: 'cad.settings', title: 'CAD Units' },
    ])
  })

  it('ignores tools without a valid ui:// resource URI or malformed entrypoint payloads', () => {
    expect(mcpAppEntrypointKinds({
      name: 'no_ui',
      _meta: { 'openai/ui': { entrypoints: [{ type: 'global' }] } },
    })).toEqual([])
    expect(mcpAppEntrypointKinds({
      name: 'https_ui',
      _meta: { ui: { resourceUri: 'https://evil.example/app.html' }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
    })).toEqual([])
    expect(mcpAppEntrypointKinds({
      name: 'bad_bag',
      _meta: { ui: { resourceUri: 'ui://board/index.html' }, 'openai/ui': { entrypoints: 'global' } },
    })).toEqual([])
    expect(toMcpAppEntrypointDescriptor({ server: 's', tool: { name: 'no_ui' } })).toBeNull()
  })

  it('roundtrips global entrypoint keys and builds collision-safe thread keys', () => {
    const key = mcpAppEntrypointKey('codex', 'my:server', 'tool/name')
    expect(parseMcpAppEntrypointKey(key)).toEqual({ harness: 'codex', server: 'my:server', tool: 'tool/name' })
    expect(parseMcpAppEntrypointKey('invalid')).toBeNull()
    expect(parseMcpAppEntrypointKey(JSON.stringify(['cursor', 's', 't']))).toBeNull()
    expect(mcpAppThreadEntrypointKey('sess:1', 'a', 'b:c')).not.toBe(mcpAppThreadEntrypointKey('sess', '1:a', 'b:c'))
  })

  it('roundtrips standalone global session ids with or without a project path and deduplicates shared global entrypoints across harnesses when sessionless', () => {
    const emptyProj = mcpAppStandaloneSessionId('codex', '')
    expect(parseMcpAppStandaloneSessionId(emptyProj)).toEqual({ harness: 'codex', projectPath: '' })

    const withProj = mcpAppStandaloneSessionId('claude', '/Users/me/My Project:v1')
    expect(parseMcpAppStandaloneSessionId(withProj)).toEqual({ harness: 'claude', projectPath: '/Users/me/My Project:v1' })
    expect(parseMcpAppStandaloneSessionId('sess-123')).toBeNull()
    expect(parseMcpAppStandaloneSessionId('mcp-global:cursor:foo')).toBeNull()

    const claudeDup = toMcpAppEntrypointDescriptor({
      server: 'bits',
      harness: 'claude',
      tool: {
        name: 'cad.library',
        title: 'Bits & Bolts',
        _meta: { ui: { resourceUri: 'ui://bits/app.html' }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
      },
    })!
    const codexDup = toMcpAppEntrypointDescriptor({
      server: 'bits',
      harness: 'codex',
      tool: {
        name: 'cad.library',
        title: 'Bits & Bolts',
        _meta: { ui: { resourceUri: 'ui://bits/app.html' }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
      },
    })!

    expect(filterMcpAppEntrypointsForContext([claudeDup, codexDup], { hasSession: false })).toHaveLength(1)
    expect(filterMcpAppEntrypointsForContext([claudeDup, codexDup], { hasSession: false, provider: 'codex' })).toEqual([codexDup])
  })
})
