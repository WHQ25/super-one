import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EmptyResultSchema, ResourceUpdatedNotificationSchema, ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpAppHost, type McpAppHostExecutor } from './host'
import { mcpAppFileCapabilities, mcpAppMessageCapabilities } from './capabilities'
import { MCP_APP_RESOURCE_WRITE_MAX_BYTES } from '../mcp-app-files'
import type { ToolAppAttachment } from '../mcp-apps'

const FILE_URI = 'host-resource://part'
const app: ToolAppAttachment = {
  appInstanceId: 'file', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  resourceUri: 'ui://cad/viewer', file: { name: 'part.stl', resourceUri: FILE_URI }, toolInput: { file: { name: 'part.stl', resourceUri: FILE_URI } },
  toolResult: { content: [] }, status: 'result',
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })

async function setup(file = true) {
  const executor: McpAppHostExecutor = {
    callTool: vi.fn(), sendMessage: vi.fn(), updateModelContext: vi.fn(), openLink: vi.fn(), requestDisplayMode: vi.fn(async mode => mode),
    readResource: vi.fn(async ({ uri }) => ({ contents: [{ uri, text: 'solid part' }] })),
    subscribeResource: vi.fn(async () => {}), unsubscribeResource: vi.fn(async () => {}),
    writeResource: vi.fn(async () => ({ outcome: 'saved' as const, etag: 'v2' })),
  }
  const [hostTransport, viewTransport] = InMemoryTransport.createLinkedPair()
  const host = createMcpAppHost({ app, transport: hostTransport, executor, context: {},
    capabilities: { ...(file ? mcpAppFileCapabilities : mcpAppMessageCapabilities), serverResources: {} } })
  const view = new App({ name: 'cad', version: '1' }, {}, { autoResize: false })
  const updates: string[] = []
  view.setNotificationHandler(ResourceUpdatedNotificationSchema, notification => { updates.push(notification.params.uri) })
  cleanup.push(async () => { host.revoke(); await host.dispose(); await view.close() })
  await host.connect()
  await view.connect(viewTransport)
  await host.update(app)
  return { host, view, executor, updates }
}

describe('MCP App host: file resources', () => {
  it('advertises only file resources to a View opened on a file', async () => {
    const { view } = await setup()
    expect(view.getHostCapabilities()?.experimental).toEqual({ 'openai/resource': {} })
    expect(view.getHostCapabilities()).not.toHaveProperty('message')
  })

  it('forwards the requested representation on reads', async () => {
    const { view, executor } = await setup()
    await view.readServerResource({ uri: FILE_URI, _meta: { 'openai/resource': { representation: 'blob' } } })
    expect(executor.readResource).toHaveBeenCalledWith({ uri: FILE_URI, representation: 'blob' }, expect.any(AbortSignal))
  })

  it('notifies only subscribed URIs, and stops after unsubscribe', async () => {
    const { view, host, executor, updates } = await setup()
    host.resourceUpdated(FILE_URI)
    await view.request({ method: 'resources/subscribe', params: { uri: FILE_URI } }, EmptyResultSchema)
    expect(executor.subscribeResource).toHaveBeenCalledWith({ uri: FILE_URI }, expect.any(AbortSignal))
    host.resourceUpdated('host-resource://other')
    host.resourceUpdated(FILE_URI)
    await vi.waitFor(() => expect(updates).toEqual([FILE_URI]))
    await view.request({ method: 'resources/unsubscribe', params: { uri: FILE_URI } }, EmptyResultSchema)
    host.resourceUpdated(FILE_URI)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(updates).toEqual([FILE_URI])
  })

  it('writes through the executor and answers too-large without calling it', async () => {
    const { view, executor } = await setup()
    await expect(view.request({ method: 'openai/resources/write', params: { uri: FILE_URI, text: 'solid edited', ifMatch: 'v1' } } as never, ResultSchema))
      .resolves.toMatchObject({ outcome: 'saved', etag: 'v2' })
    expect(executor.writeResource).toHaveBeenCalledWith({ uri: FILE_URI, text: 'solid edited', ifMatch: 'v1' }, expect.any(AbortSignal))
    const blob = Buffer.alloc(MCP_APP_RESOURCE_WRITE_MAX_BYTES + 3).toString('base64')
    await expect(view.request({ method: 'openai/resources/write', params: { uri: FILE_URI, blob } } as never, ResultSchema))
      .resolves.toMatchObject({ outcome: 'too-large', maxBytes: MCP_APP_RESOURCE_WRITE_MAX_BYTES })
    expect(executor.writeResource).toHaveBeenCalledTimes(1)
    await expect(view.request({ method: 'openai/resources/write', params: { uri: FILE_URI, text: 'a', blob: 'Yg==' } } as never, ResultSchema)).rejects.toThrow()
  })

  it('offers none of this to a transcript View', async () => {
    const { view, executor } = await setup(false)
    await expect(view.request({ method: 'resources/subscribe', params: { uri: FILE_URI } }, EmptyResultSchema)).rejects.toThrow()
    await expect(view.request({ method: 'openai/resources/write', params: { uri: FILE_URI, text: 'x' } } as never, ResultSchema)).rejects.toThrow()
    expect(executor.subscribeResource).not.toHaveBeenCalled()
    expect(executor.writeResource).not.toHaveBeenCalled()
  })
})
