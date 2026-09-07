import { describe, expect, it } from 'vitest'
import type { McpServerInfo } from '@superone/shared/agent-types'
import { mcpServerRow, requestMcpServers } from './mcp-status'

const server = (over: Partial<McpServerInfo>): McpServerInfo =>
  ({ name: 'files', status: 'connected', ...over }) as McpServerInfo

describe('mcpServerRow', () => {
  it('counts the tools a connected server actually brought', () => {
    // "Connected" alone does not say whether the server contributed anything.
    expect(mcpServerRow(server({ toolCount: 7 }))).toMatchObject({ detail: '7 tools', tone: 'ok' })
    expect(mcpServerRow(server({ tools: [{ name: 'read' }] as McpServerInfo['tools'] })).detail).toBe('1 tool')
    expect(mcpServerRow(server({})).detail).toBe('0 tools')
  })

  it('shows why a server is not up, not just that it is not', () => {
    expect(mcpServerRow(server({ status: 'failed', error: 'spawn ENOENT\nat Object' })))
      .toMatchObject({ detail: 'spawn ENOENT', tone: 'bad' })
    expect(mcpServerRow(server({ status: 'failed' })).detail).toBe('Failed to start')
  })

  it('sends an unauthenticated server to the machine that can sign in', () => {
    // A phone cannot complete an OAuth flow, so the row says where to.
    expect(mcpServerRow(server({ status: 'needs-auth' })))
      .toMatchObject({ detail: 'Needs sign-in on the desktop', tone: 'warn' })
  })

  it('separates a server still starting from one switched off', () => {
    expect(mcpServerRow(server({ status: 'pending' }))).toMatchObject({ detail: 'Connecting…', tone: 'warn' })
    expect(mcpServerRow(server({ status: 'disabled' }))).toMatchObject({ detail: 'Disabled', tone: 'off' })
  })
})

describe('requestMcpServers', () => {
  const client = (reply: unknown) => ({ request: async () => reply })

  it('reads the servers the session is running', async () => {
    const { rows } = await requestMcpServers(client({ servers: [server({ toolCount: 2 })] }), '/work/app')
    expect(rows).toEqual([{ name: 'files', status: 'connected', detail: '2 tools', tone: 'ok' }])
  })

  it('reports a host that could not answer', async () => {
    expect(await requestMcpServers(client({ error: 'No active session' }), '/work/app'))
      .toEqual({ rows: [], error: 'No active session' })
  })

  it('treats a host too old to know the command as having no servers', async () => {
    // An older desktop answers `{}`; an empty list is honest there — it has not
    // told us about any.
    expect(await requestMcpServers(client({}), '/work/app')).toEqual({ rows: [] })
  })
})
