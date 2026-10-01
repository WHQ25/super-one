import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import type { McpUiAppCapabilities, McpUiToolResultNotification } from '@modelcontextprotocol/ext-apps/app-bridge'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpAppHost, createMcpAppHostSlot } from './host'
import { mcpAppMessageCapabilities } from './capabilities'
import type { McpAppHost, McpAppHostExecutor } from './host'
import { McpAppsError, MCP_APP_OUTPUT_MAX_BYTES } from '../mcp-apps'
import type { ToolAppAttachment } from '../mcp-apps'

const attachment: ToolAppAttachment = {
  appInstanceId: 'one', binding: { node: 'local', session: 'session', server: 'fixture', configGeneration: 1, configFingerprint: 'stable' },
  resourceUri: 'ui://fixture/items', toolInput: { page: 1 },
  toolResult: { content: [{ type: 'text', text: 'items' }], structuredContent: { page: 1 }, _meta: { private: 'view-only' } }, status: 'result',
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })

async function setup(restored = false, initial = attachment, appCapabilities: McpUiAppCapabilities = {}, beforeInitialize?: (host: McpAppHost) => Promise<void>) {
  const executor: McpAppHostExecutor = {
    callTool: vi.fn(async () => ({ result: attachment.toolResult!, outcome: 'completed' as const })),
    readResource: vi.fn(async () => ({ contents: [{ uri: attachment.resourceUri, text: 'html' }] })),
    sendMessage: vi.fn(async () => ({})), updateModelContext: vi.fn(async context => ({ ...context, updateId: 'update-1' })),
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
    context: { theme: 'dark' }, capabilities: { ...mcpAppMessageCapabilities, serverTools: {}, serverResources: {}, openLinks: {} },
    onError: error => errors.push(error),
    onUnknownOutcome: unknownOutcome,
  })
  cleanup.push(async () => { host.revoke(); await host.dispose(); await view.close() })
  await host.connect()
  await beforeInitialize?.(host)
  await view.connect(viewTransport)
  if (!beforeInitialize) await host.update(initial)
  return { executor, host, view, notifications, results, errors, unknownOutcome }
}

describe('MCP App shared host', () => {
  it('advertises rich messages and preserves OpenAI request metadata through AppBridge', async () => {
    const { view, executor } = await setup()
    expect(view.getHostCapabilities()).toMatchObject({ experimental: { 'openai/message': {} }, message: { text: {}, image: {}, resourceLink: {}, resource: {} } })
    const params = { role: 'user' as const, content: [{ type: 'text' as const, text: 'part', _meta: { 'openai/title': 'Part' } }], _meta: { 'openai/message': { target: 'new' } } }
    await view.sendMessage(params)
    expect(executor.sendMessage).toHaveBeenCalledWith(params, expect.any(AbortSignal))
  })
  it('delivers a large View-only result but rejects oversized results and inputs', async () => {
    const { view, executor } = await setup()
    vi.mocked(executor.callTool).mockResolvedValue({ outcome: 'completed', result: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES - 100) }] } })
    await expect(view.callServerTool({ name: 'large' })).resolves.toHaveProperty('content')
    vi.mocked(executor.callTool).mockResolvedValue({ outcome: 'completed', result: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES) }] } })
    await expect(view.callServerTool({ name: 'large' })).rejects.toThrow('size limit')
    await expect(view.callServerTool({ name: 'large', arguments: { x: 'x'.repeat(1024 * 1024) } })).rejects.toThrow('size limit')
    expect(executor.callTool).toHaveBeenCalledTimes(2)
    vi.mocked(executor.readResource).mockResolvedValue({ contents: [{ uri: 'ui://large', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES - 100) }] })
    await expect(view.readServerResource({ uri: 'ui://large' })).resolves.toHaveProperty('contents')
    vi.mocked(executor.readResource).mockResolvedValue({ contents: [{ uri: 'ui://large', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES) }] })
    await expect(view.readServerResource({ uri: 'ui://large' })).rejects.toThrow('size limit')
  })

  it('returns a policy refusal to the View without replacing it with a host error', async () => {
    const { view, executor, errors } = await setup()
    vi.mocked(executor.callTool).mockRejectedValueOnce(new McpAppsError('denied', 'Model-only tool'))
    await expect(view.callServerTool({ name: 'model-only' })).rejects.toThrow('Model-only')
    expect(errors).toEqual([])
    await expect(view.callServerTool({ name: 'next' })).resolves.toMatchObject({ structuredContent: { page: 1 } })
    expect(executor.callTool).toHaveBeenCalledTimes(2)
  })
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

  it('advertises rich context, restores its revision, returns updateId and notifies a clear', async () => {
    const initial = { ...attachment, modelContext: { updateId: 'restored-id', content: [{ type: 'text', text: 'restored', _meta: { 'openai/title': 'Part' } }], source: { appInstanceId: 'one', server: 'fixture' } } }
    const { view, host } = await setup(false, initial)
    expect(view.getHostCapabilities()).toMatchObject({ experimental: { 'openai/modelContext': {} }, updateModelContext: { image: {}, resource: {}, resourceLink: {}, structuredContent: {} } })
    expect(view.getHostContext()?.['openai/modelContext']).toMatchObject({ updateId: 'restored-id', content: initial.modelContext.content })
    const result = await view.updateModelContext({ content: [{ type: 'text', text: 'new' }] })
    expect(result._meta).toEqual({ 'openai/modelContext': { updateId: 'update-1' } })
    const changes: unknown[] = []
    view.onhostcontextchanged = params => { changes.push(params) }
    await host.update({ ...initial, modelContext: null })
    await vi.waitFor(() => expect(changes).toContainEqual({ 'openai/modelContext': null }))
    const remount = await setup(true, { ...initial, modelContext: null })
    expect(remount.view.getHostContext()?.['openai/modelContext']).toBeNull()
  })

  it('initializes with a removal that happened while the View was still loading', async () => {
    const initial = { ...attachment, modelContext: { updateId: 'old', content: [{ type: 'text', text: 'Old' }], source: { appInstanceId: 'one', server: 'fixture' } } }
    const { view } = await setup(false, initial, {}, host => host.update({ ...initial, modelContext: null }))
    expect(view.getHostContext()?.['openai/modelContext']).toBeNull()
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
    await expect(host.update({ ...attachment, appInstanceId: 'another' })).rejects.toThrow('binding changed')
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

  it('omits the initial result notification while a size-limited View remains usable', async () => {
    const { notifications, results, errors, view } = await setup(false, { ...attachment, toolResult: undefined, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' } })
    expect(notifications).toEqual(['input'])
    expect(results).toEqual([]); expect(errors).toEqual([])
    expect((await view.callServerTool({ name: 'next' })).content).toEqual(attachment.toolResult!.content)
  })

  it('bounds legacy oversized payloads before initial/update notifications and rejects invalid bindings asynchronously', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const huge = { ...attachment, toolResult: { content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] } }
      const { host, notifications, results, errors } = await setup(false, huge)
      await expect(host.update(huge)).resolves.toBeUndefined()
      expect(notifications).toEqual(['input']); expect(results).toEqual([]); expect(errors).toEqual([])
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
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

  it('starts inline even with a fullscreen preference and restricts requests using resource modes', async () => {
    const { host, view, executor } = await setup(false, { ...attachment, resource: { html: '', hash: 'x', meta: { 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline'] } } } })
    expect(view.getHostContext()?.displayMode).toBeUndefined() // This fixture has only theme; no executor moves on initialize.
    expect(executor.requestDisplayMode).not.toHaveBeenCalled()
    host.updateContext({ displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen', 'pip'] })
    expect(await view.requestDisplayMode({ mode: 'fullscreen' })).toEqual({ mode: 'inline' })
    expect(await view.requestDisplayMode({ mode: 'pip' })).toEqual({ mode: 'inline' })
    expect(executor.requestDisplayMode).not.toHaveBeenCalled()
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
