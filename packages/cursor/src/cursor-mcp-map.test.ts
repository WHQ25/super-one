import { describe, expect, it } from 'vitest'
import { stripStdioCwd, toCursorMcpConfig } from './cursor-mcp-map'

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
