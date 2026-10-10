import { describe, expect, it, vi } from 'vitest'
import type { McpAppsProvider } from '@superone/shared/mcp-apps'
import { dispatchMcpAppsProviderRequest } from './provider-rpc'

describe('MCP App provider control', () => {
  it('revalidates the admitted grant after tool discovery before dispatch', async () => {
    let controlled = true
    const callTool = vi.fn()
    const dispose = vi.fn()
    const provider = { tools: async () => { controlled = false; return new Map([['next', { name: 'next' }]]) }, callTool, dispose } as unknown as McpAppsProvider
    const result = await dispatchMcpAppsProviderRequest({ binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'cfg' }, origin: { providerSessionId: 'p' }, operation: 'callTool', tool: 'next' }, provider, undefined, () => {
      if (!controlled) throw new Error('lease stale')
    })
    expect(result).toMatchObject({ ok: false, error: { message: 'lease stale' } })
    expect(callTool).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
