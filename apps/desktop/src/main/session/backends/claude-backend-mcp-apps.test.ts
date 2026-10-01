import { afterEach, expect, it, vi } from 'vitest'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import { hoisted, makeStartOpts } from './claude-backend.fixture'
import { ClaudeBackend } from './claude-backend'

const config = { type: 'stdio', command: 'old-server' }
const binding = { node: 'local', session: 'sess-test', server: 'cad', configGeneration: 0, configFingerprint: mcpServerConfigFingerprint(config) }
const origin = { providerSessionId: 'thread' }
const runtimes: ClaudeBackend[] = []
afterEach(async () => {
  hoisted.captured.iterationDone?.resolve()
  await Promise.all(runtimes.splice(0).map(backend => backend.close()))
  hoisted.captured.mockQueryMcpServerStatus.mockReset().mockResolvedValue([])
})

async function start() {
  const backend = new ClaudeBackend(); runtimes.push(backend)
  hoisted.captured.mockQueryMcpServerStatus.mockResolvedValue([{ name: 'cad', status: 'connected', config, tools: [{ name: 'next' }] }])
  await backend.start(makeStartOpts())
  hoisted.captured.onSessionId?.('thread')
  // This also seeds the catalog, as the original live View did.
  const provider = await backend.getMcpAppsProvider(binding, origin)
  return { backend, provider }
}

it('refuses the same-name server loaded by idle revive even with the same resume id', async () => {
  const { backend, provider } = await start()
  hoisted.captured.iterationDone?.resolve()
  await backend.releaseRuntime('idle')
  const read = vi.fn(), call = vi.fn(), auth = vi.fn()
  hoisted.captured.mockQueryMcpServerStatus.mockResolvedValue([{ name: 'cad', status: 'connected', config: { ...config, command: 'new-server' }, tools: [{ name: 'next' }] }])
  // The resumed subprocess keeps its thread identity but exposes new native methods.
  const create = hoisted.captured.createSessionQueryMock.getMockImplementation()!
  hoisted.captured.createSessionQueryMock.mockImplementationOnce((...args) => {
    const handle = create(...args)
    Object.assign(handle.query, { readMcpResource: read, request: call, mcpAuthenticate: auth })
    return handle
  })
  await expect(provider.readResource({ uri: 'ui://cad', origin }, new AbortController().signal)).rejects.toMatchObject({ code: 'not_connected' })
  await expect(provider.callTool({ tool: 'next', args: {}, origin }, new AbortController().signal)).rejects.toMatchObject({ code: 'not_connected' })
  await expect(provider.authenticate!({}, new AbortController().signal)).rejects.toMatchObject({ code: 'not_connected' })
  expect(read).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  expect(backend.getCurrentProviderSessionId()).toBe('thread')
  await expect(backend.getMcpAppsProvider(binding, origin)).rejects.toMatchObject({ code: 'not_connected' })
})

it('rejects an account change after a provider was obtained and the runtime rebuilt', async () => {
  const { backend, provider } = await start()
  hoisted.captured.iterationDone?.resolve()
  await backend.rebuild({ ...makeStartOpts(), apiProviderId: 'other', providerSessionId: 'thread' })
  await expect(provider.readResource({ uri: 'ui://cad', origin }, new AbortController().signal)).rejects.toMatchObject({ code: 'not_connected', message: 'MCP App account changed' })
  await expect(backend.getMcpAppsProvider(binding, origin)).rejects.toMatchObject({ code: 'not_connected', message: 'MCP App account changed' })
})

it('rejects a configuration changed during tool discovery before mcp_call', async () => {
  const { provider } = await start()
  hoisted.captured.mockQueryMcpServerStatus.mockResolvedValue([{ name: 'cad', status: 'connected', config: { ...config, command: 'changed' }, tools: [{ name: 'next' }] }])
  await expect(provider.tools()).rejects.toMatchObject({ code: 'not_connected' })
})

it('ignores old runtime status arriving after revive and keeps the old View disconnected', async () => {
  const { backend, provider } = await start()
  let finish!: (value: unknown[]) => void
  hoisted.captured.mockQueryMcpServerStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const oldStatus = backend.getMcpServerStatus()
  await vi.waitFor(() => expect(finish).toBeDefined())
  hoisted.captured.iterationDone?.resolve()
  await backend.releaseRuntime('idle')
  hoisted.captured.mockQueryMcpServerStatus.mockResolvedValue([{ name: 'cad', status: 'connected', config: { ...config, command: 'new-server' }, tools: [{ name: 'next' }] }])
  const read = () => provider.readResource({ uri: 'ui://cad', origin }, new AbortController().signal)
  await expect(read()).rejects.toMatchObject({ code: 'not_connected', message: 'MCP App server configuration changed' })
  finish([{ name: 'cad', status: 'connected', config, tools: [{ name: 'next' }] }])
  expect(await oldStatus).toEqual([])
  await expect(read()).rejects.toMatchObject({ code: 'not_connected', message: 'MCP App server configuration changed' })
})
