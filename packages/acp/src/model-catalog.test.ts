import { expect, it, vi } from 'vitest'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { spawnAcpProcess } from './process'
import { probeAcpModels } from './model-catalog'
vi.mock('./process', () => ({ spawnAcpProcess: vi.fn() }))

it('discovers Grok models over the real SDK without sending a prompt or MCP servers', async () => {
  const calls: string[] = []
  const outgoing = new TransformStream<Uint8Array>()
  const incoming = new TransformStream<Uint8Array>()
  const peer = agent({ name: 'test-grok' })
    .onRequest(methods.agent.initialize, async () => {
      calls.push('initialize')
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [{ id: 'cached_token', name: 'Cached' }] }
    })
    .onRequest(methods.agent.authenticate, async () => { calls.push('authenticate'); return {} })
    .onRequest(methods.agent.session.new, async ctx => {
      calls.push('new')
      expect(ctx.params.mcpServers).toEqual([])
      return { sessionId: 's1', configOptions: [{ id: 'model', name: 'Model', type: 'select' as const,
        category: 'model', currentValue: 'grok-full', options: [{ value: 'grok-full', name: 'Full' }] }],
        models: { currentModelId: 'grok-full', availableModels: [{ modelId: 'grok-full', name: 'Full', _meta: { totalContextTokens: 200000 } }] } }
    })
    .onRequest(methods.agent.session.prompt, async () => { calls.push('prompt'); return { stopReason: 'end_turn' as const } })
    .connect(ndJsonStream(incoming.writable, outgoing.readable))
  const kill = vi.fn(async () => { peer.close() })
  vi.mocked(spawnAcpProcess).mockReturnValue({ stream: ndJsonStream(outgoing.writable, incoming.readable), kill } as unknown as ReturnType<typeof spawnAcpProcess>)
  expect(await probeAcpModels({ launch: { command: 'grok', agentId: 'grok-build' }, cwd: '/tmp' })).toEqual([
    { id: 'grok-full', name: 'Full', description: '', isDefault: true, contextWindow: 200000 },
  ])
  expect(calls).toEqual(['initialize', 'authenticate', 'new'])
  expect(kill).toHaveBeenCalledOnce()
})

it('bounds a stuck discovery and closes its process', async () => {
  const outgoing = new TransformStream<Uint8Array>()
  const incoming = new TransformStream<Uint8Array>()
  const peer = agent({ name: 'stuck-agent' })
    .onRequest(methods.agent.initialize, async () => new Promise<never>(() => {}))
    .connect(ndJsonStream(incoming.writable, outgoing.readable))
  const kill = vi.fn(async () => { peer.close() })
  vi.mocked(spawnAcpProcess).mockReturnValue({ stream: ndJsonStream(outgoing.writable, incoming.readable), kill } as unknown as ReturnType<typeof spawnAcpProcess>)
  await expect(probeAcpModels({ launch: { command: 'grok' }, cwd: '/tmp', timeoutMs: 10 })).rejects.toThrow('timed out')
  expect(kill).toHaveBeenCalledOnce()
})
