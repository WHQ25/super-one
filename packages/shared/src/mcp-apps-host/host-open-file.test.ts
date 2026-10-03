import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpAppHost, type McpAppHostExecutor } from './host'
import { MCP_APP_OPEN_FILES_EXTENSION, mcpAppFileCapabilities, mcpAppMessageCapabilities } from './capabilities'
import type { ToolAppAttachment } from '../mcp-apps'

const app: ToolAppAttachment = {
  appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  resourceUri: 'ui://cad/viewer', toolResult: { content: [] }, status: 'result',
}
const open = (path: unknown) => ({ method: 'openai/files/open', params: { path } }) as never
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })

async function setup(options: { openFiles?: boolean; file?: boolean } = {}) {
  const executor: McpAppHostExecutor = {
    callTool: vi.fn(), sendMessage: vi.fn(), updateModelContext: vi.fn(), openLink: vi.fn(), requestDisplayMode: vi.fn(async mode => mode),
    readResource: vi.fn(), subscribeResource: vi.fn(async () => {}), openFile: vi.fn(async () => {}),
  }
  const base = options.file ? mcpAppFileCapabilities : mcpAppMessageCapabilities
  const capabilities = options.openFiles === false ? base : { ...base, experimental: { ...base.experimental, ...MCP_APP_OPEN_FILES_EXTENSION } }
  const [hostTransport, viewTransport] = InMemoryTransport.createLinkedPair()
  const host = createMcpAppHost({ app, transport: hostTransport, executor, context: {}, capabilities })
  const view = new App({ name: 'cad', version: '1' }, {}, { autoResize: false })
  cleanup.push(async () => { host.revoke(); await host.dispose(); await view.close() })
  await host.connect()
  await view.connect(viewTransport)
  return { view, executor }
}

describe('MCP App host: openai/files/open', () => {
  it('advertises openai/files next to the message extensions and forwards the path', async () => {
    const { view, executor } = await setup()
    expect(view.getHostCapabilities()?.experimental).toMatchObject({ 'openai/files': {}, 'openai/message': {} })
    await expect(view.request(open('/workspace/parts/hex-bolt.stl'), EmptyResultSchema)).resolves.toEqual({})
    expect(executor.openFile).toHaveBeenCalledWith({ path: '/workspace/parts/hex-bolt.stl' }, expect.any(AbortSignal))
  })

  it('rejects a missing or non-string path before the executor', async () => {
    const { view, executor } = await setup()
    await expect(view.request(open(''), EmptyResultSchema)).rejects.toThrow()
    await expect(view.request(open(42), EmptyResultSchema)).rejects.toThrow()
    expect(executor.openFile).not.toHaveBeenCalled()
  })

  it('keeps file-entrypoint resource methods working alongside it', async () => {
    const { view, executor } = await setup({ file: true })
    await view.request(open('/workspace/a.stl'), EmptyResultSchema)
    await view.request({ method: 'resources/subscribe', params: { uri: 'host-resource://a' } }, EmptyResultSchema)
    expect(executor.openFile).toHaveBeenCalledTimes(1)
    expect(executor.subscribeResource).toHaveBeenCalledTimes(1)
  })

  it('answers method-not-found when the host did not advertise it', async () => {
    const { view, executor } = await setup({ openFiles: false })
    expect(view.getHostCapabilities()?.experimental).not.toHaveProperty('openai/files')
    await expect(view.request(open('/workspace/a.stl'), EmptyResultSchema)).rejects.toThrow(/Method not found/)
    expect(executor.openFile).not.toHaveBeenCalled()
  })
})
