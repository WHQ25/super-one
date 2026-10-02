import { describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@superone/shared/agent-types'

const { files } = vi.hoisted(() => ({ files: [] as McpServerConfig[] }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => files }))
import { claudeHostClientConfig } from './claude-host-config'

const stdio = (patch: Partial<McpServerConfig> = {}): McpServerConfig =>
  ({ name: 'cad', type: 'stdio', scope: 'project', command: 'node', args: ['server.js'], env: { CAD_HOME: '/data' }, ...patch }) as McpServerConfig

describe('claudeHostClientConfig', () => {
  it('takes stdio env from the config file Claude read when command and args match', () => {
    files.splice(0, files.length, stdio())
    expect(claudeHostClientConfig('/p', 'cad', { type: 'stdio', command: 'node', args: ['server.js'] }))
      .toEqual({ type: 'stdio', command: 'node', args: ['server.js'], env: { CAD_HOME: '/data' } })
  })

  it('never hands that env to a different command, and refuses servers it cannot match', () => {
    files.splice(0, files.length, stdio())
    expect(claudeHostClientConfig('/p', 'cad', { type: 'stdio', command: 'node', args: ['other.js'] })).toBeNull()
    expect(claudeHostClientConfig('/p', 'cad', { type: 'stdio', command: 'python', args: ['server.js'] })).toBeNull()
    expect(claudeHostClientConfig('/p', 'plugin-server', { type: 'stdio', command: 'node', args: ['server.js'] })).toBeNull()
  })

  it('passes HTTP configs through and refuses what only Claude can reach', () => {
    expect(claudeHostClientConfig('/p', 'web', { type: 'http', url: 'https://mcp.example.com/mcp', headers: { A: 'b' } }))
      .toEqual({ type: 'http', url: 'https://mcp.example.com/mcp', headers: { A: 'b' } })
    expect(claudeHostClientConfig('/p', 'docs', { type: 'claudeai-proxy', url: 'https://claude.ai/x', id: 'c' })).toBeNull()
  })
})
