import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpAppHost, type McpAppHostExecutor } from './host'
import { mcpAppMessageCapabilities } from './capabilities'
import type { ToolAppAttachment } from '../mcp-apps'

const app: ToolAppAttachment = {
  appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  resourceUri: 'ui://cad/viewer', toolResult: { content: [] }, status: 'result',
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })

describe('MCP App host: ui/download-file', () => {
  async function download(advertise: boolean) {
    const executor: McpAppHostExecutor = {
      callTool: vi.fn(), sendMessage: vi.fn(), updateModelContext: vi.fn(), openLink: vi.fn(), requestDisplayMode: vi.fn(async mode => mode),
      readResource: vi.fn(), downloadFile: vi.fn(async () => ({ isError: true })),
    }
    const [hostTransport, viewTransport] = InMemoryTransport.createLinkedPair()
    const host = createMcpAppHost({ app, transport: hostTransport, executor, context: {}, capabilities: { ...mcpAppMessageCapabilities, ...(advertise ? { downloadFile: {} } : {}) } })
    const view = new App({ name: 'cad', version: '1' }, {}, { autoResize: false })
    cleanup.push(async () => { host.revoke(); await host.dispose(); await view.close() })
    await host.connect()
    await view.connect(viewTransport)
    return { view, executor }
  }
  const contents = [{ type: 'resource' as const, resource: { uri: 'file:///part.stl', mimeType: 'model/stl', text: 'solid part' } }]

  it('forwards the contents and passes a cancel back as isError', async () => {
    const { view, executor } = await download(true)
    expect(view.getHostCapabilities()?.downloadFile).toEqual({})
    await expect(view.downloadFile({ contents })).resolves.toEqual({ isError: true })
    expect(executor.downloadFile).toHaveBeenCalledWith(contents, expect.any(AbortSignal))
  })

  it('does not handle downloads it did not advertise', async () => {
    const { view, executor } = await download(false)
    expect(view.getHostCapabilities()).not.toHaveProperty('downloadFile')
    await expect(view.downloadFile({ contents })).rejects.toThrow()
    expect(executor.downloadFile).not.toHaveBeenCalled()
  })
})
