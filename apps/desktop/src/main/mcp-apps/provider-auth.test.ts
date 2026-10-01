import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { createClaudeMcpAppsProvider } from '@superone/claude/mcp-apps'
import { createCodexMcpAppsProvider } from '@superone/codex/mcp-apps'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'fp' }
const signal = new AbortController().signal

function claude(query: Record<string, unknown>, status = 'connected') {
  return createClaudeMcpAppsProvider(binding, {
    assertBinding: () => {},
    query: async () => query as unknown as Query,
    providerSessionId: () => 'sid',
    tools: async () => new Map(),
    serverStatus: async () => status,
  })
}

describe('Claude MCP Apps sign-in', () => {
  it('refuses reads, calls and tool listing before dispatch while the server needs sign-in', async () => {
    const query = { request: vi.fn(), readMcpResource: vi.fn() }
    const p = claude(query, 'needs-auth')
    await expect(p.callTool({ tool: 'next', args: {} }, signal)).rejects.toMatchObject({ code: 'auth_required' })
    await expect(p.readResource({ uri: 'ui://fixture/items.html' }, signal)).rejects.toMatchObject({ code: 'auth_required' })
    await expect(p.tools()).rejects.toMatchObject({ code: 'auth_required' })
    expect(query.request).not.toHaveBeenCalled()
    expect(query.readMcpResource).not.toHaveBeenCalled()
  })

  it('reports a server that is still connecting as not connected, not as a denied tool', async () => {
    await expect(claude({ request: vi.fn() }, 'pending').tools()).rejects.toMatchObject({ code: 'not_connected' })
  })

  it('lets the CLI receive the redirect unless the host asked for it and the server accepted', async () => {
    const mcpAuthenticate = vi.fn()
      .mockResolvedValueOnce({ authUrl: 'https://as/a', redirectScheme: 'localhost' })
      .mockResolvedValueOnce({ authUrl: 'https://as/b', redirectScheme: 'custom' })
      .mockResolvedValueOnce({ requiresUserAction: false })
    const p = claude({ mcpAuthenticate, mcpSubmitOAuthCallbackUrl: vi.fn() })
    expect(await p.authenticate!({}, signal)).toEqual({ authUrl: 'https://as/a', completion: 'harness' })
    expect(await p.authenticate!({ redirectUri: 'http://127.0.0.1:9/cb' }, signal)).toEqual({ authUrl: 'https://as/b', completion: 'host-callback' })
    expect(mcpAuthenticate).toHaveBeenLastCalledWith('fixture', 'http://127.0.0.1:9/cb')
    expect(await p.authenticate!({}, signal)).toEqual({ completion: 'done' })
  })

  it('reconnects after a relayed callback, because the CLI stays in needs-auth until then', async () => {
    const order: string[] = []
    const p = claude({
      mcpAuthenticate: vi.fn(),
      mcpSubmitOAuthCallbackUrl: vi.fn(async () => { order.push('submit') }),
      reconnectMcpServer: vi.fn(async (name: string) => { order.push(`reconnect:${name}`) }),
    })
    await p.submitAuthCallback!({ callbackUrl: 'http://127.0.0.1:9/cb?code=1' }, signal)
    expect(order).toEqual(['submit', 'reconnect:fixture'])
    expect((await p.ready(signal)).authenticate).toBe(true)
  })
})

describe('Codex MCP Apps sign-in', () => {
  it('starts the thread-scoped Codex login and leaves the redirect to Codex', async () => {
    const request = vi.fn(async () => ({ authorizationUrl: 'https://as/codex' }))
    const p = createCodexMcpAppsProvider(binding, 'thread-1', request)
    expect(await p.authenticate!({ redirectUri: 'http://127.0.0.1:9/cb' }, signal)).toEqual({ authUrl: 'https://as/codex', completion: 'harness' })
    expect(request).toHaveBeenCalledWith('mcpServer/oauth/login', expect.objectContaining({ name: 'fixture', threadId: 'thread-1' }))
  })
})
