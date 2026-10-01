import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import type { McpUiAppCapabilities, McpUiToolResultNotification } from '@modelcontextprotocol/ext-apps/app-bridge'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpAppHost, createMcpAppHostSlot } from './host'
import type { McpAppHost, McpAppHostExecutor } from './host'
import { McpAppsError } from '../mcp-apps'
import type { ToolAppAttachment } from '../mcp-apps'

const attachment: ToolAppAttachment = {
  appInstanceId: 'one', binding: { node: 'local', session: 'session', server: 'fixture', configGeneration: 1, configFingerprint: 'stable' },
  resourceUri: 'ui://fixture/items', toolInput: { page: 1 },
  toolResult: { content: [{ type: 'text', text: 'items' }], structuredContent: { page: 1 }, _meta: { private: 'view-only' } }, status: 'result',
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })

async function setup(restored = false, initial = attachment, appCapabilities: McpUiAppCapabilities = {}) {
  const executor: McpAppHostExecutor = {
    callTool: vi.fn(async () => ({ result: attachment.toolResult!, outcome: 'completed' as const })),
    readResource: vi.fn(async () => ({ contents: [{ uri: attachment.resourceUri, text: 'html' }] })),
    sendMessage: vi.fn(async () => ({})), updateModelContext: vi.fn(async () => {}),
    openLink: vi.fn(async () => ({})), requestDisplayMode: vi.fn(async mode => mode),
  }
  const [hostTransport, viewTransport] = InMemoryTransport.createLinkedPair()
  const notifications: string[] = []
  const results: McpUiToolResultNotification['params'][] = []
  const view = new App({ name: 'fixture', version: '1' }, appCapabilities, { autoResize: false })
  view.ontoolinput = () => { notifications.push('input') }
  view.ontoolinputpartial = () => { notifications.push('partial') }
  view.ontoolresult = result => { notifications.push(`result:${result._meta?.private}`); results.push(result) }
  view.ontoolcancelled = () => { notifications.push('cancelled') }
  const errors: unknown[] = []
  const unknownOutcome = vi.fn()
  const host = createMcpAppHost({ app: initial, transport: hostTransport, executor, restored,
    context: { theme: 'dark' }, capabilities: { serverTools: {}, serverResources: {}, openLinks: {}, message: { text: {} }, updateModelContext: { text: {} } },
    onError: error => errors.push(error),
    onUnknownOutcome: unknownOutcome,
  })
  cleanup.push(async () => { host.revoke(); await host.dispose(); await view.close() })
  await host.connect()
  await view.connect(viewTransport)
  await host.update(initial)
  return { executor, host, view, notifications, results, errors, unknownOutcome }
}

describe('MCP App shared host', () => {
  it('closes activation after the host restarts and waits for an explicit Activate', async () => {
    const { host, view, executor, errors } = await setup()
    vi.mocked(executor.callTool).mockRejectedValueOnce(new McpAppsError('inactive', 'Activate to reconnect'))
    await expect(view.callServerTool({ name: 'next' })).rejects.toThrow('Activate')
    expect(errors[0]).toMatchObject({ code: 'inactive' })
    await expect(view.callServerTool({ name: 'next' })).rejects.toThrow('Activate')
    expect(executor.callTool).toHaveBeenCalledTimes(1)
    host.activate()
    await view.callServerTool({ name: 'next' })
    expect(executor.callTool).toHaveBeenCalledTimes(2)
  })
  it('initializes before sending input then full private View result exactly once', async () => {
    const { host, notifications, errors } = await setup()
    await host.update(attachment)
    expect(notifications).toEqual(['input', 'result:view-only'])
    expect(errors).toEqual([])
  })

  it('paints restored results but gates every executor until explicit activation', async () => {
    const { host, view, executor, notifications, errors } = await setup(true)
    expect(notifications).toEqual(['input', 'result:view-only'])
    await expect(view.callServerTool({ name: 'next' })).rejects.toThrow('Activate')
    await expect(view.readServerResource({ uri: 'ui://fixture/items' })).rejects.toThrow('Activate')
    await expect(view.sendMessage({ role: 'user', content: [{ type: 'text', text: 'go' }] })).rejects.toThrow('Activate')
    expect(executor.callTool).not.toHaveBeenCalled()
    expect(executor.readResource).not.toHaveBeenCalled()
    expect(executor.sendMessage).not.toHaveBeenCalled()
    expect(errors).toHaveLength(3)
    expect(errors.every(error => error instanceof McpAppsError && error.code === 'inactive')).toBe(true)
    host.activate()
    const result = await view.callServerTool({ name: 'next', arguments: { page: 2 } })
    expect(result._meta).toEqual({ private: 'view-only' })
    expect(executor.callTool).toHaveBeenCalledWith({ tool: 'next', args: { page: 2 } }, expect.any(AbortSignal))
  })

  it('sends only changed host context fields and skips unchanged notifications', async () => {
    const { host, view } = await setup()
    const changes: unknown[] = []
    view.onhostcontextchanged = change => { changes.push(change) }
    host.updateContext({ theme: 'dark' })
    host.updateContext({ theme: 'light', locale: 'en' })
    host.updateContext({ theme: 'light', locale: 'en' })
    host.updateContext({ theme: 'light', locale: 'zh' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(changes).toEqual([{ theme: 'light', locale: 'en' }, { locale: 'zh' }])
  })

  it('attributes model context to the original View and excludes extraneous private meta', async () => {
    const { view, executor } = await setup()
    await view.updateModelContext({ content: [{ type: 'text', text: 'selected' }], structuredContent: { id: 'a' } })
    expect(executor.updateModelContext).toHaveBeenCalledWith({ content: [{ type: 'text', text: 'selected' }], structuredContent: { id: 'a' }, source: { appInstanceId: 'one', server: 'fixture' } }, expect.any(AbortSignal))
  })

  it('limits message loops and rejects unsafe links before calling the executor', async () => {
    const { view, executor } = await setup()
    for (let i = 0; i < 3; i++) await view.sendMessage({ role: 'user', content: [{ type: 'text', text: 'go' }] })
    await expect(view.sendMessage({ role: 'user', content: [{ type: 'text', text: 'loop' }] })).rejects.toThrow('rate limit')
    expect(executor.sendMessage).toHaveBeenCalledTimes(3)
    await expect(view.openLink({ url: 'file:///private/data' })).rejects.toThrow('Unsupported')
    expect(executor.openLink).not.toHaveBeenCalled()
    await view.openLink({ url: 'https://example.test/docs' })
    expect(executor.openLink).toHaveBeenCalledTimes(1)
  })

  it('forwards pending input and cancellation in protocol order', async () => {
    const { host, notifications } = await setup(false, { ...attachment, status: 'pending', toolResult: undefined })
    expect(notifications).toEqual(['partial'])
    await host.update({ ...attachment, status: 'cancelled' })
    expect(notifications).toEqual(['partial', 'input', 'cancelled'])
    expect(() => host.update({ ...attachment, appInstanceId: 'another' })).toThrow('binding changed')
  })

  it('surfaces auth failures to the native shell and does not retry uncertain calls', async () => {
    const { view, executor, errors, unknownOutcome } = await setup()
    vi.mocked(executor.callTool).mockRejectedValueOnce(new McpAppsError('auth_required', 'Sign in'))
    await expect(view.callServerTool({ name: 'next' })).rejects.toThrow('Sign in')
    expect(errors).toHaveLength(1)
    vi.mocked(executor.callTool).mockResolvedValueOnce({ result: { content: [{ type: 'text', text: 'May have completed' }], isError: true }, outcome: 'unknown_outcome' })
    expect((await view.callServerTool({ name: 'next' })).isError).toBe(true)
    expect(executor.callTool).toHaveBeenCalledTimes(2)
    expect(unknownOutcome).toHaveBeenCalledTimes(1)
  })

  it('sends a terminal error result when the provider has no result payload', async () => {
    const { notifications, results, errors } = await setup(false, { ...attachment, toolResult: undefined, status: 'error', error: { code: 'invalid', message: 'Result exceeds the size limit' } })
    expect(notifications).toEqual(['input', 'result:undefined'])
    expect(results).toEqual([{ content: [{ type: 'text', text: 'Result exceeds the size limit' }], isError: true }])
    expect(errors).toEqual([])
  })

  it('accepts explicit intent when the View omits its optional mode declaration', async () => {
    const { host, view, executor } = await setup()
    host.updateContext({ availableDisplayModes: ['inline', 'fullscreen', 'pip'] })
    expect(host.appCapabilities()).toEqual({})
    expect(await view.requestDisplayMode({ mode: 'fullscreen' })).toEqual({ mode: 'fullscreen' })
    expect(executor.requestDisplayMode).toHaveBeenCalledOnce()
    host.updateContext({ availableDisplayModes: ['inline'] })
    expect(await view.requestDisplayMode({ mode: 'fullscreen' })).toEqual({ mode: 'inline' })
    expect(executor.requestDisplayMode).toHaveBeenCalledOnce()
  })

  it('allows only modes declared by both the host and the View', async () => {
    const { host, view, executor } = await setup(false, attachment, { availableDisplayModes: ['inline', 'fullscreen'] })
    host.updateContext({ availableDisplayModes: ['inline', 'fullscreen', 'pip'] })
    expect(await view.requestDisplayMode({ mode: 'fullscreen' })).toEqual({ mode: 'fullscreen' })
    expect(await view.requestDisplayMode({ mode: 'pip' })).toEqual({ mode: 'inline' })
    expect(executor.requestDisplayMode).toHaveBeenCalledTimes(1)
  })

  it('surfaces unsupported provider content through the shell error callback', async () => {
    const { notifications, errors } = await setup(false, { ...attachment, toolResult: { content: [{ type: 'tool_result', text: 'SDK-only block' }] } })
    expect(notifications).toEqual(['input'])
    expect(errors).toHaveLength(1)
  })

  it('revokes the prior bridge before a StrictMode replacement becomes live', async () => {
    const { host, view, executor } = await setup()
    const slot = createMcpAppHostSlot()
    slot.replace(host)
    const next = { revoke: vi.fn(), dispose: vi.fn(async () => {}) } as unknown as McpAppHost
    slot.replace(next)
    await expect(view.callServerTool({ name: 'next' }, { timeout: 50 })).rejects.toThrow()
    expect(executor.callTool).not.toHaveBeenCalled()
    await slot.release(next)
    expect(next.dispose).toHaveBeenCalledTimes(1)
  })
})
