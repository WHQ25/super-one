import { describe, expect, it } from 'vitest'
import { McpAppsError, type McpAppsProvider } from '@superone/shared/mcp-apps'
import { cancelMcpAppsInvocationsForClient, dispatchMcpAppsRpc } from './mcp-apps-handlers'
import type { RpcContext } from './handlers'

/** A tool call that runs until the node aborts it, as a call waiting on an MCP form does. */
function pendingProvider() {
  const signals: AbortSignal[] = []
  const provider = {
    binding: { node: 'node', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
    tools: async () => new Map([['pick', { name: 'pick', inputSchema: { type: 'object' } }]]),
    callTool: (_request: unknown, signal: AbortSignal) => new Promise((_, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new McpAppsError('cancelled', 'MCP App request cancelled')), { once: true })
    }),
    dispose: () => {},
  } as unknown as McpAppsProvider
  return { provider, signals }
}

function context(clientSessionId: string, provider: McpAppsProvider): RpcContext {
  return {
    client: { clientSessionId, scopes: ['session:read', 'session:operate'] },
    identity: { environmentId: 'node' },
    leases: { assertValid: () => {} },
    sessions: { getMcpAppsProvider: async () => provider },
  } as unknown as RpcContext
}

const call = (invocationId: string) => ({ binding: { node: 'node', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  origin: { providerSessionId: 'thread' }, operation: 'callTool', tool: 'pick', args: {}, leaseId: 'l', generation: 'g', invocationId })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const CANCELLED = { result: { ok: false, error: { code: 'cancelled' } } }

describe('node mcpApps.cancel', () => {
  it("aborts the client's own in-flight provider request, and no one else's", async () => {
    const { provider, signals } = pendingProvider()
    const pending = dispatchMcpAppsRpc('mcpApps.provider', call('a'), context('desktop', provider))
    await settle()
    expect(await dispatchMcpAppsRpc('mcpApps.cancel', { invocationId: 'a' }, context('phone', provider))).toEqual({ result: null })
    expect(signals[0].aborted).toBe(false)
    expect(await dispatchMcpAppsRpc('mcpApps.cancel', { invocationId: 'a' }, context('desktop', provider))).toEqual({ result: null })
    await expect(pending).resolves.toMatchObject(CANCELLED)
    cancelMcpAppsInvocationsForClient('phone')
  })

  it('honours a cancel that arrives before its request', async () => {
    const { provider, signals } = pendingProvider()
    await dispatchMcpAppsRpc('mcpApps.cancel', { invocationId: 'early' }, context('desktop', provider))
    await expect(dispatchMcpAppsRpc('mcpApps.provider', call('early'), context('desktop', provider))).resolves.toMatchObject(CANCELLED)
    expect(signals).toHaveLength(0)
  })

  it("aborts a disconnected client's requests", async () => {
    const { provider } = pendingProvider()
    const pending = dispatchMcpAppsRpc('mcpApps.provider', call('b'), context('desktop', provider))
    await settle()
    cancelMcpAppsInvocationsForClient('desktop')
    await expect(pending).resolves.toMatchObject(CANCELLED)
  })

  it('requires an invocation id and session:operate', async () => {
    const { provider } = pendingProvider()
    expect(await dispatchMcpAppsRpc('mcpApps.cancel', {}, context('desktop', provider))).toMatchObject({ error: { code: 'invalid_argument' } })
    const reader = { ...context('desktop', provider), client: { clientSessionId: 'desktop', scopes: ['session:read'] } } as unknown as RpcContext
    expect(await dispatchMcpAppsRpc('mcpApps.cancel', { invocationId: 'x' }, reader)).toMatchObject({ error: { code: 'forbidden' } })
  })
})
