import { describe, expect, it } from 'vitest'
import {
  parseGrokMcpInitProgress,
  parseGrokMcpServerStatus,
  parseGrokMcpServersUpdated,
  parseGrokSessionUsage,
  upsertMcpServer,
} from './acp-xai-mcp-status'

describe('parseGrokMcpServerStatus', () => {
  it('maps ready + tools', () => {
    expect(parseGrokMcpServerStatus({
      sessionId: 's',
      name: 'github',
      status: 'ready',
      reason: 'handshake',
      tools: [{ name: 'search', description: 'q' }],
    })).toEqual({
      name: 'github',
      status: 'connected',
      error: 'handshake',
      tools: [{ name: 'search', description: 'q' }],
      toolCount: 1,
    })
  })

  it('maps needsAuth', () => {
    expect(parseGrokMcpServerStatus({ name: 'linear', status: 'needsAuth' })).toMatchObject({
      name: 'linear',
      status: 'needs-auth',
      authStatus: 'needs-auth',
    })
  })
})

describe('parseGrokMcpInitProgress / servers_updated', () => {
  it('reads connected/total', () => {
    expect(parseGrokMcpInitProgress({ total: 4, connected: 1 })).toEqual({ total: 4, connected: 1 })
  })

  it('reads mcpServers list', () => {
    const list = parseGrokMcpServersUpdated({ mcpServers: [{ name: 'a', status: 'initializing' }, 'b'] })
    expect(list?.map((s) => s.name)).toEqual(['a', 'b'])
    expect(list?.[0]?.status).toBe('pending')
  })
})

describe('upsert / usage', () => {
  it('replaces a named server in place', () => {
    const next = upsertMcpServer(
      [{ name: 'a', status: 'pending' }],
      { name: 'a', status: 'connected', toolCount: 3 },
    )
    expect(next).toEqual([{ name: 'a', status: 'connected', toolCount: 3 }])
  })

  it('parses session/usage totals', () => {
    expect(parseGrokSessionUsage({
      usage: { inputTokens: 100, outputTokens: 20 },
    })).toEqual({ totalTokens: 120, inputTokens: 100, outputTokens: 20 })
  })
})
