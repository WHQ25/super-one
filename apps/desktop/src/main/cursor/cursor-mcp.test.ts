import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/superone-test' },
  BrowserWindow: class BrowserWindow {},
  session: {},
  ipcMain: { handle: () => undefined },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpStdioConfig: () => null,
}))
vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: () => [],
}))

import { stripStdioCwd, toCursorMcpConfig } from './cursor-mcp'
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
