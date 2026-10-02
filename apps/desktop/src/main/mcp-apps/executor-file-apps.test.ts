import { describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import type { McpAppHostOperation, McpAppHostRequest, McpToolDescriptor, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { MCP_APP_RESOURCE_READ_MAX_BYTES, MCP_APP_RESOURCE_WRITE_MAX_BYTES } from '@superone/shared/mcp-app-files'

const FILE_URI = 'host-resource://opened'
const BASE: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad/viewer', status: 'result' }
const signal = () => new AbortController().signal

function setup(file: boolean) {
  const app: ToolAppAttachment = file ? { ...BASE, file: { name: 'part.stl', resourceUri: FILE_URI } } : BASE
  const target: McpAppResolvedTarget = { ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', messageId: '', app }
  const tools = vi.fn(async () => new Map<string, McpToolDescriptor>([['cad.readPart', { name: 'cad.readPart', _meta: { ui: { visibility: ['app'] } } }]]))
  const callTool = vi.fn(async () => ({ result: { content: [] }, outcome: 'completed' as const }))
  const readResource = vi.fn(async (req: { uri: string }) => ({ contents: [{ uri: req.uri, text: 'server' }] }))
  const hostResource = vi.fn<NonNullable<McpAppExecutorPorts['hostResource']>>(async (_target, request) =>
    request.kind === 'read' ? { contents: [{ uri: request.uri, text: 'solid part' }] } : request.kind === 'write' ? { outcome: 'saved', etag: 'v2' } : undefined)
  const ports: McpAppExecutorPorts = {
    resolve: async () => target,
    provider: (resolved, operation, abort) => dispatchMcpAppsProviderRequest({ ...operation, binding: resolved.app.binding, origin: resolved.app.origin! }, {
      binding: resolved.app.binding, tools, callTool, readResource,
      async ready() { return { mode: 'native', resourceRead: true, toolCall: true, authenticate: false } },
      dispose() {},
    }, abort),
    persist: vi.fn(async () => {}), sendMessage: vi.fn(async () => {}),
    hostResource, fileToolMeta: () => ({ 'openai/resource': { path: '/project/part.stl' } }),
  }
  const executor = new McpAppExecutor(ports)
  executor.observeLive(target.ref, app)
  const run = (operation: McpAppHostOperation) => executor.execute({ sessionKey: 'local:s', appInstanceId: 'view', ...operation } as McpAppHostRequest, { kind: 'desktop' }, signal())
  return { run, callTool, readResource, hostResource, ports }
}

describe('MCP App executor: Views opened on a file', () => {
  it('reads, subscribes to and writes only through the host for its own resource', async () => {
    const s = setup(true)
    await expect(s.run({ operation: 'readResource', uri: FILE_URI, representation: 'blob' })).resolves.toEqual({ ok: true, value: { contents: [{ uri: FILE_URI, text: 'solid part' }] } })
    expect(s.hostResource).toHaveBeenLastCalledWith(expect.anything(), { kind: 'read', uri: FILE_URI, representation: 'blob' }, expect.anything())
    expect(s.readResource).not.toHaveBeenCalled()
    await expect(s.run({ operation: 'subscribeResource', uri: FILE_URI })).resolves.toEqual({ ok: true, value: {} })
    await expect(s.run({ operation: 'writeResource', params: { uri: FILE_URI, text: 'solid edited', ifMatch: 'v1' } })).resolves.toEqual({ ok: true, value: { outcome: 'saved', etag: 'v2' } })
    expect(s.hostResource).toHaveBeenLastCalledWith(expect.anything(), { kind: 'write', params: { uri: FILE_URI, text: 'solid edited', ifMatch: 'v1' } }, expect.anything())
  })

  it('saves files larger than the 1 MiB View request cap, up to what it can open', async () => {
    const s = setup(true)
    // An ASCII STL export of a small binary part is already several MiB.
    const blob = Buffer.alloc(MCP_APP_RESOURCE_WRITE_MAX_BYTES).toString('base64')
    await expect(s.run({ operation: 'writeResource', params: { uri: FILE_URI, blob } })).resolves.toEqual({ ok: true, value: { outcome: 'saved', etag: 'v2' } })
    expect(MCP_APP_RESOURCE_WRITE_MAX_BYTES).toBe(MCP_APP_RESOURCE_READ_MAX_BYTES)
  })

  it('still reads its UI and other server resources from the server', async () => {
    const s = setup(true)
    await expect(s.run({ operation: 'readResource', uri: 'cad://parts/bolt' })).resolves.toMatchObject({ ok: true })
    expect(s.readResource).toHaveBeenCalledWith(expect.objectContaining({ uri: 'cad://parts/bolt', transient: true }), expect.anything())
    expect(s.hostResource).not.toHaveBeenCalled()
  })

  it('adds the file path to its tool calls as request metadata', async () => {
    const s = setup(true)
    await expect(s.run({ operation: 'callTool', tool: 'cad.readPart', args: { partId: 'bolt' } })).resolves.toMatchObject({ ok: true })
    expect(s.callTool).toHaveBeenCalledWith(expect.objectContaining({ meta: { 'openai/resource': { path: '/project/part.stl' } } }), expect.anything())
  })

  it('cannot message the conversation or attach model context', async () => {
    const s = setup(true)
    await expect(s.run({ operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    await expect(s.run({ operation: 'updateModelContext', context: { content: [{ type: 'text', text: 'part' }], source: { appInstanceId: '', server: '' } } })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
    expect(s.ports.persist).not.toHaveBeenCalled()
  })

  it('rejects malformed writes before they reach the host', async () => {
    const s = setup(true)
    await expect(s.run({ operation: 'writeResource', params: { uri: FILE_URI, text: 'a', blob: 'Yg==' } as never })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(s.run({ operation: 'writeResource', params: { uri: FILE_URI, text: 'a', ifMatch: '' } })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(s.hostResource).not.toHaveBeenCalled()
  })
})

describe('MCP App executor: transcript Views', () => {
  it('cannot subscribe to, write or read host resources, and its calls carry no file metadata', async () => {
    const s = setup(false)
    await expect(s.run({ operation: 'subscribeResource', uri: FILE_URI })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    await expect(s.run({ operation: 'writeResource', params: { uri: FILE_URI, text: 'x' } })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    await expect(s.run({ operation: 'readResource', uri: FILE_URI })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    await s.run({ operation: 'callTool', tool: 'cad.readPart', args: {} })
    expect(s.callTool).toHaveBeenCalledWith(expect.not.objectContaining({ meta: expect.anything() }), expect.anything())
    expect(s.hostResource).not.toHaveBeenCalled()
  })
})
