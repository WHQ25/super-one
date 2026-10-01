import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { AgentIpcChannels as C } from '@superone/shared/agent-types'
import { McpAppsError, type McpAppHostRequest, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { McpAppResourceRegistry } from './protocol'

const native = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), resolve: vi.fn(), execute: vi.fn(), active: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => native.handlers.set(channel, handler) } }))
vi.mock('./executor', () => ({ resolveMcpAppHostAttachment: native.resolve, executeMcpAppHostRequest: native.execute, isMcpAppHostActive: native.active }))
import { registerMcpAppDocumentIpc } from './document-ipc'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', resource: { html: '<html>authoritative</html>', hash: 'hash', meta: {} } }
const target: McpAppResolvedTarget = { ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', messageId: 'm', app, sessionApprovals: [{ node: 'local', session: 's', server: 'fixture', configFingerprint: 'config', tool: 'next_page' }] }

function setup(owner = 1) {
  const resources = new McpAppResourceRegistry()
  registerMcpAppDocumentIpc(resources)
  const sender = Object.assign(new EventEmitter(), { id: owner, mainFrame: { url: 'superone-renderer://app' }, isDestroyed: () => false })
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, ...args: unknown[]) => native.handlers.get(channel)!(event, ...args)
  const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, op) => op.operation === 'ready' ? { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }
    : op.operation === 'tools' ? { ok: true, value: [{ name: 'next_page' }] } : { ok: true, value: { outcome: 'completed', result: { content: [] } } })
  const executor = new McpAppExecutor({ resolve: async () => target, persist: async () => {}, provider, sendMessage: async () => {}, openLink: async () => {} })
  executor.observeLive(target.ref, app)
  native.resolve.mockResolvedValue(target)
  native.active.mockImplementation(value => executor.isActive(value))
  native.execute.mockImplementation((request, requester, signal = new AbortController().signal, validate) => executor.execute(request, requester, signal, validate))
  const register = async (): Promise<McpAppDocumentRegistration> => {
    const result = await invoke(C.MCP_APP_REGISTER_DOCUMENT, '/project', 's', { appInstanceId: 'view', messageId: 'hint', resource: { html: 'forged' } })
    expect(result.ok).toBe(true)
    return result.value.document
  }
  const request = { appInstanceId: 'view', operation: 'callTool', tool: 'next_page', args: {} } as const
  return { resources, sender, event, invoke, provider, executor, register, request }
}

beforeEach(() => { native.handlers.clear(); native.resolve.mockReset(); native.execute.mockReset() })

describe('MCP App native document IPC', () => {
  it('registers only the authoritative snapshot and refuses privileged operations without a lease', async () => {
    const s = setup()
    const document = await s.register()
    expect(await s.resources.handle(new Request(document.url)).text()).toBe(app.resource!.html)
    expect(native.resolve).toHaveBeenCalledWith({ sessionKey: 'local:s', appInstanceId: 'view', messageId: 'hint' })
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', { appInstanceId: 'view', operation: 'load' })).toMatchObject({ ok: true, value: app.resource })
    const subframe = { ...s.event, senderFrame: { url: document.url } }
    expect(await native.handlers.get(C.MCP_APP_REGISTER_DOCUMENT)!(subframe, '/project', 's', { appInstanceId: 'view' })).toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('paints restored snapshots without provider access and leaves missing snapshots inactive', async () => {
    const s = setup()
    native.active.mockReturnValue(false)
    expect(await s.invoke(C.MCP_APP_REGISTER_DOCUMENT, '/project', 's', { appInstanceId: 'view' })).toMatchObject({ ok: true, value: { state: 'ready', active: false } })
    native.resolve.mockResolvedValue({ ...target, app: { ...app, resource: undefined } })
    expect(await s.invoke(C.MCP_APP_REGISTER_DOCUMENT, '/project', 's', { appInstanceId: 'view' })).toEqual({ ok: true, value: { state: 'inactive' } })
    expect(s.provider).not.toHaveBeenCalled()
  })

  it('loads live snapshots through the common executor before registering', async () => {
    const s = setup()
    native.resolve.mockResolvedValue({ ...target, app: { ...app, resource: undefined } })
    native.execute.mockResolvedValue({ ok: true, value: app.resource })
    expect(await s.invoke(C.MCP_APP_REGISTER_DOCUMENT, '/project', 's', { appInstanceId: 'view' })).toMatchObject({ ok: true, value: { state: 'ready', active: true } })
    expect(native.execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'load', sessionKey: 'local:s' }), { kind: 'desktop' })
  })

  it('rejects another View/session/owner and changed provider bindings before provider access', async () => {
    const s = setup()
    const document = await s.register()
    const context = { documentId: document.id, requestId: 'request' }
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 'other', s.request, context)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', { ...s.request, appInstanceId: 'another' }, context)).toMatchObject({ ok: false, error: { code: 'denied' } })
    const original = s.event.sender.id
    Object.assign(s.event.sender, { id: 2 })
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request, context)).toMatchObject({ ok: false, error: { code: 'denied' } })
    Object.assign(s.event.sender, { id: original })
    native.execute.mockImplementation(async (_req: McpAppHostRequest, _requester, _signal, validate) => {
      try { validate({ ...target, app: { ...app, binding: { ...app.binding, account: 'changed' } } }) }
      catch (error) { return { ok: false, error: (error as McpAppsError).toJSON() } }
    })
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request, context)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.provider).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'release', 'cancel', 'destroy'] as const)('stops pre-dispatch work on native %s', async kind => {
    const s = setup()
    const document = await s.register()
    let finish!: () => void
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { finish = resolve })
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, op, signal) => { if (op.operation === 'ready') { entered(); await wait }; return original(target, op, signal) })
    const context = { documentId: document.id, requestId: 'request' }
    const result = s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request, context)
    await ready
    if (kind === 'navigation') s.resources.revoke(document.url)
    else if (kind === 'release') s.invoke(C.MCP_APP_RELEASE_DOCUMENT, document.id)
    else if (kind === 'cancel') s.invoke(C.MCP_APP_CANCEL_REQUEST, context)
    else s.sender.emit('destroyed')
    finish()
    expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })

  it('does not delete an existing execution when a duplicate request id is rejected', async () => {
    const s = setup()
    const document = await s.register()
    let finish!: () => void
    const wait = new Promise<void>(resolve => { finish = resolve })
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, op, signal) => { if (op.operation === 'ready') await wait; return original(target, op, signal) })
    const context = { documentId: document.id, requestId: 'duplicate' }
    const first = s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request, context)
    expect(await s.invoke(C.MCP_APP_HOST_REQUEST, '/project', 's', s.request, context)).toMatchObject({ ok: false, error: { code: 'denied' } })
    s.invoke(C.MCP_APP_CANCEL_REQUEST, context)
    finish()
    expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })
})
