import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { McpServerConfig } from '@superone/shared/agent-types'
import type { McpToolDescriptor } from '@superone/shared/mcp-apps'
import { createMcpAppEntrypointsStore } from './entrypoints-cache'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempCachePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'entrypoints-cache-'))
  dirs.push(dir)
  return path.join(dir, 'mcp-app-entrypoints.json')
}

const boardTool: McpToolDescriptor = {
  name: 'open_board',
  title: 'Sprint Board',
  description: 'Interactive sprint planning board',
  serverInfo: { name: 'linear', title: 'Linear' },
  _meta: {
    ui: { resourceUri: 'ui://linear/board.html', visibility: ['app'] },
    'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
  },
}

const calendarTool: McpToolDescriptor = {
  name: 'open_calendar',
  title: 'Calendar',
  _meta: {
    ui: { resourceUri: 'ui://cal/view.html' },
    'openai/ui': { entrypoints: [{ type: 'global' }] },
  },
}

describe('MCP App global entrypoints cache and lazy discovery', () => {
  it('returns cached apps on cold startup without spawning servers, then discovers lazily on demand', async () => {
    const cacheFile = tempCachePath()
    const claudeCfg: McpServerConfig = { name: 'linear', type: 'stdio', command: 'linear-mcp', args: ['--v1'], scope: 'user' }
    const codexCfg: McpServerConfig = { name: 'cal', type: 'http', url: 'https://cal.example/mcp', scope: 'user' }
    const discoverServerTools = vi.fn(async (_harness: string, serverName: string) => {
      if (serverName === 'linear') return new Map([['open_board', boardTool]])
      return new Map([['open_calendar', calendarTool]])
    })

    const store = createMcpAppEntrypointsStore({
      cachePath: () => cacheFile,
      claudeConfigs: () => [claudeCfg],
      codexConfigs: () => [codexCfg],
      isTrustedProjectStdio: () => true,
      discoverServerTools,
    })

    store.recordSessionTools('/proj', 'claude', 'linear', mcpServerConfigFingerprint(claudeCfg), [boardTool])

    const cold = await store.readGlobal('/proj', { discover: false })
    expect(discoverServerTools).not.toHaveBeenCalled()
    expect(cold.entrypoints.map(e => e.title)).toEqual(['Sprint Board'])
    expect(cold.incomplete).toBe(true)

    const warm = await store.readGlobal('/proj', { discover: true })
    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith('codex', 'cal', expect.anything(), '/proj')
    expect(warm.incomplete).toBeUndefined()
    expect(warm.entrypoints.map(e => e.title)).toEqual(['Calendar', 'Sprint Board'])
  })

  it('invalidates cached entrypoints when configFingerprint changes and skips untrusted project stdio servers', async () => {
    const cacheFile = tempCachePath()
    let linearArgs = ['--v1']
    const untrustedRepoStdio: McpServerConfig = { name: 'repo-evil', type: 'stdio', command: './evil.sh', scope: 'project' }
    const discoverServerTools = vi.fn(async () => new Map([['open_board', boardTool]]))

    const store = createMcpAppEntrypointsStore({
      cachePath: () => cacheFile,
      claudeConfigs: () => [
        { name: 'linear', type: 'stdio', command: 'linear-mcp', args: linearArgs, scope: 'user' },
        untrustedRepoStdio,
      ],
      codexConfigs: () => [],
      isTrustedProjectStdio: () => false,
      discoverServerTools,
    })

    const first = await store.readGlobal('/proj', { discover: true })
    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith('claude', 'linear', expect.anything(), '/proj')
    expect(first.entrypoints.map(e => e.tool)).toEqual(['open_board'])
    expect(first.incomplete).toBe(true)

    linearArgs = ['--v2']
    const coldAfterConfigChange = await store.readGlobal('/proj', { discover: false })
    expect(coldAfterConfigChange.entrypoints).toEqual([])
    expect(coldAfterConfigChange.incomplete).toBe(true)

    const rediscovered = await store.readGlobal('/proj', { discover: true })
    expect(discoverServerTools).toHaveBeenCalledTimes(2)
    expect(rediscovered.entrypoints.map(e => e.tool)).toEqual(['open_board'])
  })

  it('caches thread-only tools, retains per-harness descriptors, and scopes discovery to options.harness', async () => {
    const cacheFile = tempCachePath()
    const threadOnlyTool: McpToolDescriptor = {
      name: 'query_studio',
      title: 'Query Studio',
      _meta: {
        ui: { resourceUri: 'ui://pg/studio.html' },
        'openai/ui': { entrypoints: [{ type: 'thread' }] },
      },
    }
    const claudeLinear: McpServerConfig = { name: 'linear', type: 'stdio', command: 'linear-mcp', scope: 'user' }
    const codexLinear: McpServerConfig = { name: 'linear', type: 'stdio', command: 'linear-mcp', scope: 'user' }
    const codexPg: McpServerConfig = { name: 'pg', type: 'http', url: 'https://pg.example/mcp', scope: 'user' }

    const discoverServerTools = vi.fn(async (_harness: string, serverName: string) => {
      if (serverName === 'linear') return new Map([['open_board', boardTool]])
      return new Map([['query_studio', threadOnlyTool]])
    })

    const store = createMcpAppEntrypointsStore({
      cachePath: () => cacheFile,
      claudeConfigs: () => [claudeLinear],
      codexConfigs: () => [codexLinear, codexPg],
      isTrustedProjectStdio: () => true,
      discoverServerTools,
    })

    const claudeOnly = await store.readGlobal('/proj', { harness: 'claude', discover: true })
    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith('claude', 'linear', expect.anything(), '/proj')
    expect(claudeOnly.incomplete).toBeUndefined()
    expect(claudeOnly.entrypoints).toHaveLength(1)
    expect(claudeOnly.entrypoints[0]).toMatchObject({
      harness: 'claude',
      tool: 'open_board',
      kinds: ['global', 'thread'],
    })

    const allDiscovered = await store.readGlobal('/proj', { discover: true })
    expect(discoverServerTools).toHaveBeenCalledTimes(3)
    expect(allDiscovered.incomplete).toBeUndefined()
    expect(allDiscovered.entrypoints.map(e => ({ harness: e.harness, tool: e.tool, kinds: e.kinds }))).toEqual([
      { harness: 'codex', tool: 'query_studio', kinds: ['thread'] },
      { harness: 'claude', tool: 'open_board', kinds: ['global', 'thread'] },
      { harness: 'codex', tool: 'open_board', kinds: ['global', 'thread'] },
    ])
  })

  it('discovers user-scope global entrypoints without an open project and reuses the user cache across projects', async () => {
    const cacheFile = tempCachePath()
    const userHttp: McpServerConfig = { name: 'cal', type: 'http', url: 'https://cal.example/mcp', scope: 'user' }
    const projectStdio: McpServerConfig = { name: 'repo-only', type: 'stdio', command: './repo-mcp', scope: 'project' }
    const discoverServerTools = vi.fn(async () => new Map([['open_calendar', calendarTool]]))

    const store = createMcpAppEntrypointsStore({
      cachePath: () => cacheFile,
      claudeConfigs: () => [],
      codexConfigs: (cwd) => (cwd ? [userHttp, projectStdio] : [userHttp]),
      isTrustedProjectStdio: () => true,
      discoverServerTools,
    })

    const withoutProject = await store.readGlobal('', { discover: true })
    expect(withoutProject.unavailable).toBeUndefined()
    expect(withoutProject.incomplete).toBeUndefined()
    expect(withoutProject.entrypoints.map(e => e.title)).toEqual(['Calendar'])
    expect(discoverServerTools).toHaveBeenCalledTimes(1)

    const inProjectCold = await store.readGlobal('/proj-a', { discover: false })
    expect(inProjectCold.entrypoints.map(e => e.title)).toEqual(['Calendar'])
    expect(inProjectCold.incomplete).toBe(true)
  })
})
