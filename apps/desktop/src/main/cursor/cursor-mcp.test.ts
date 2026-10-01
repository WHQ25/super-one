import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { closeCompatSession, setCompatSession, type CompatSession } from '../mcp-apps/compat-registry'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/superone-test' },
  BrowserWindow: class BrowserWindow {},
  session: {},
  ipcMain: { handle: () => undefined },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
const { httpConfig, configs } = vi.hoisted(() => ({
  configs: [] as McpServerConfig[],
  httpConfig: {
    url: 'http://127.0.0.1:60309/mcp',
    headers: { Authorization: 'Bearer test', 'X-Superone-Session': 's1' },
  } as { url: string; headers: Record<string, string> } | null,
}))

vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpStdioConfig: () => null,
  getSuperoneMcpHttpConfig: () => httpConfig,
}))
vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: () => configs,
}))

import { buildCursorMcpServers, stripStdioCwd, toCursorMcpConfig } from './cursor-mcp'
import { buildCursorCustomTools } from './cursor-custom-tools'

describe('toCursorMcpConfig', () => {
  it('maps stdio servers', () => {
    expect(toCursorMcpConfig({
      name: 'tools',
      type: 'stdio',
      scope: 'project',
      command: 'npx',
      args: ['-y', 'server'],
      env: { A: '1' },
    })).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      env: { A: '1' },
    })
  })

  it('maps http/sse servers', () => {
    expect(toCursorMcpConfig({
      name: 'remote',
      type: 'http',
      scope: 'user',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })
  })

  it('returns null for incomplete configs', () => {
    expect(toCursorMcpConfig({ name: 'x', type: 'stdio', scope: 'user' })).toBeNull()
    expect(toCursorMcpConfig({ name: 'x', type: 'http', scope: 'user' })).toBeNull()
  })
})

describe('buildCursorMcpServers', () => {
  afterEach(async () => { configs.length = 0; await closeCompatSession('s1') })
  it('injects SuperOne over HTTP so Agent.create is not blocked on stdio IPC bring-up', () => {
    expect(buildCursorMcpServers('/proj', 's1').superone).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:60309/mcp',
      headers: { Authorization: 'Bearer test', 'X-Superone-Session': 's1' },
    })
  })
  it('omits rerouted App servers only in their session and leaves source config untouched', () => {
    configs.push(
      { name: 'fixture', type: 'stdio', scope: 'project', command: 'node', args: ['fixture.ts'] },
      { name: 'plain', type: 'stdio', scope: 'project', command: 'node', args: ['plain.ts'] },
    )
    const before = JSON.stringify(configs)
    setCompatSession('s1', { omittedServers: new Set(['fixture']), close: async () => undefined } as CompatSession)
    expect(Object.keys(buildCursorMcpServers('/proj', 's1'))).toEqual(['plain', 'superone'])
    expect(Object.keys(buildCursorMcpServers('/proj', 's2'))).toEqual(['fixture', 'plain', 'superone'])
    expect(JSON.stringify(configs)).toBe(before)
  })
})

describe('stripStdioCwd', () => {
  it('removes cwd from stdio servers for cloud', () => {
    const stripped = stripStdioCwd({
      local: { type: 'stdio', command: 'node', args: ['s.js'], cwd: '/host/path' },
      remote: { type: 'http', url: 'https://example.com' },
    })
    expect(stripped.local).toEqual({ type: 'stdio', command: 'node', args: ['s.js'] })
    expect(stripped.remote).toEqual({ type: 'http', url: 'https://example.com' })
  })
})

describe('buildCursorCustomTools', () => {
  it('exposes superone_session_info', async () => {
    const tools = buildCursorCustomTools({ sessionId: 's1', cwd: '/proj' })
    expect(tools.superone_session_info).toBeDefined()
    const result = await tools.superone_session_info.execute({}, {})
    expect(result).toMatchObject({ sessionId: 's1', cwd: '/proj', host: 'superone' })
  })
})
