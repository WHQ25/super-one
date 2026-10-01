import { describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { McpAppsError, MCP_APP_MIME_TYPE, type McpAppHostOperation, type McpAppHostRequest, type McpAppHostResult, type McpAppRequester, type McpToolDescriptor, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'
import type { ChatMessage } from '@superone/shared/agent-types'

const APP: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', account: 'account', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result' }
const REQUESTER: McpAppRequester = { kind: 'desktop' }
const MESSAGE: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'Selected page 2' }] } }
const CALL: McpAppHostOperation = { operation: 'callTool', tool: 'next_page', args: { page: 2 } }
const signal = (): AbortSignal => new AbortController().signal

function setup(options: { snapshot?: boolean; fresh?: boolean; tools?: McpToolDescriptor[] } = {}) {
  const app = structuredClone(APP)
  if (options.snapshot) app.resource = { html: '<html>restored</html>', hash: 'snapshot', meta: {} }
  let messages: ChatMessage[] = [{ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app }] }]
  let now = 1000
  const target = (): McpAppResolvedTarget => ({ ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', ...findMcpAppAttachment(messages, 'view')! })
  const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, operation) => {
    if (operation.operation === 'ready') return { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }
    if (operation.operation === 'tools') return { ok: true, value: options.tools ?? [{ name: 'next_page', _meta: { ui: { visibility: ['app'] } } }] }
    if (operation.operation === 'readResource') return { ok: true, value: { contents: [{ uri: operation.uri, mimeType: MCP_APP_MIME_TYPE, text: '<html>fresh</html>', _meta: { ui: { prefersBorder: true } } }] } }
    return { ok: true, value: { result: { content: [{ type: 'text', text: 'page 2' }], isError: false }, outcome: 'completed' } }
  })
  const ports: McpAppExecutorPorts = {
    resolve: vi.fn(async () => target()), provider,
    persist: vi.fn(async (_target, update) => { messages = updateMcpAppAttachments(messages, 'view', update) }),
    sendMessage: vi.fn(async () => {}), now: () => now,
  }
  const executor = new McpAppExecutor(ports)
  if (options.fresh) executor.observeLive(target().ref, app)
  const request = (operation: McpAppHostOperation = CALL, approval?: McpAppHostRequest['approval']): McpAppHostRequest => ({ sessionKey: 'local:s', appInstanceId: 'view', messageId: 'm', ...operation, ...(approval ? { approval } : {}) })
  const run = (operation: McpAppHostOperation = CALL, approval?: McpAppHostRequest['approval'], requester = REQUESTER) => executor.execute(request(operation, approval), requester, signal())
  return { executor, ports, provider, run, request, target, change: (patch: Partial<ToolAppAttachment>) => { messages = messages.map(message => ({ ...message, content: message.content.map(block => 'app' in block && block.app ? { ...block, app: { ...block.app, ...patch } } : block) })) }, advance: (ms: number) => { now += ms } }
}

function challenge(result: McpAppHostResult): string {
  expect(result).toMatchObject({ ok: false, error: { code: 'approval_required' } })
  if (result.ok || result.error.code !== 'approval_required') throw new Error('Expected approval')
  return result.error.challenge
}

describe('MCP App host executor', () => {
  it('paints a restored snapshot without any provider call, and gates every outbound operation', async () => {
    const s = setup({ snapshot: true })
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: true, value: { html: '<html>restored</html>' } })
    for (const operation of [CALL, { operation: 'readResource', uri: APP.resourceUri }, { operation: 'updateModelContext', context: { source: { appInstanceId: 'x', server: 'x' } } }, { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }] as McpAppHostOperation[]) {
      expect(await s.run(operation)).toMatchObject({ ok: false, error: { code: 'inactive' } })
    }
    expect(s.provider).not.toHaveBeenCalled()
  })

  it('requires activation when restored HTML is missing, then persists a single load', async () => {
    const s = setup()
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: false, error: { code: 'inactive' } })
    await s.run({ operation: 'activate' })
    const loaded = await s.run({ operation: 'load' })
    expect(loaded).toMatchObject({ ok: true, value: { html: '<html>fresh</html>', meta: { prefersBorder: true } } })
    expect(s.ports.persist).toHaveBeenCalledOnce()
    s.provider.mockClear()
    expect(await s.run({ operation: 'load' })).toEqual(loaded)
    expect(s.provider).not.toHaveBeenCalled()
  })

  it('persists tool and server presentation with the resource snapshot', async () => {
    const s = setup({ fresh: true, tools: [{ name: 'library', title: 'Library', serverInfo: { title: 'CAD', icons: [{ src: 'https://example.com/cad.png' }] } }] })
    s.change({ toolName: 'library' })
    await s.run({ operation: 'load' })
    expect(s.target().app.presentation).toEqual({ toolTitle: 'Library', serverTitle: 'CAD', icons: [{ src: 'https://example.com/cad.png' }] })
  })

  it('allows a new live attachment to load automatically', async () => {
    const s = setup({ fresh: true })
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: true })
  })

  it('rejects bare ids and cross-node/session bindings before provider access', async () => {
    const s = setup({ fresh: true })
    expect(await s.executor.execute({ ...s.request(), sessionKey: 's' }, REQUESTER, signal())).toMatchObject({ ok: false, error: { code: 'invalid' } })
    s.change({ binding: { ...APP.binding, node: 'other' } })
    expect(await s.run()).toMatchObject({ ok: false, error: { code: 'denied' } })
    s.change({ binding: { ...APP.binding, session: 'other' } })
    expect(await s.run()).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.provider).not.toHaveBeenCalled()
  })

  it.each([REQUESTER, { kind: 'mobile', deviceId: 'phone' } as McpAppRequester])('calls app-visible tools without approval and denies model-only tools for %j', async requester => {
    const s = setup({ fresh: true })
    if (requester.kind === 'mobile') await s.run({ operation: 'activate' }, undefined, requester)
    expect(await s.run(CALL, undefined, requester)).toMatchObject({ ok: true, value: { outcome: 'completed' } })
    expect(s.ports.persist).not.toHaveBeenCalled()
    s.provider.mockClear()
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, op, abort) => op.operation === 'tools' ? { ok: true, value: [{ name: 'next_page', _meta: { ui: { visibility: ['model'] } } }] } : original(target, op, abort))
    expect(await s.run(CALL, undefined, requester)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })

  it('consumes a challenge exactly once, including simultaneous confirmations', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run(MESSAGE))
    const responses = await Promise.all([s.run(MESSAGE, { challenge: id }), s.run(MESSAGE, { challenge: id })])
    expect(responses.filter(result => result.ok)).toHaveLength(1)
    expect(s.ports.sendMessage).toHaveBeenCalledOnce()
  })

  it.each(['args', 'requester', 'expiry', 'binding'] as const)('rejects a challenge after %s changes', async kind => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run(MESSAGE))
    if (kind === 'expiry') s.advance(300_001)
    if (kind === 'binding') { s.change({ binding: { ...APP.binding, account: 'other' } }); await s.run({ operation: 'activate' }) }
    const call = kind === 'args' ? { ...MESSAGE, params: { role: 'user', content: [{ type: 'text', text: 'changed' }] } } as McpAppHostOperation : MESSAGE
    const requester = kind === 'requester' ? { kind: 'mobile' as const, deviceId: 'phone' } : REQUESTER
    if (kind === 'requester') await s.run({ operation: 'activate' }, undefined, requester)
    expect(await s.run(call, { challenge: id }, requester)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
  })

  it('requires activation on each requester and keeps the same device active across transports', async () => {
    const s = setup({ snapshot: true, fresh: true })
    const phone: McpAppRequester = { kind: 'mobile', deviceId: 'phone', transport: 'lan' }
    const other: McpAppRequester = { kind: 'mobile', deviceId: 'other', transport: 'relay' }
    expect(await s.run(CALL, undefined, phone)).toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(await s.run({ operation: 'activate' }, undefined, phone)).toMatchObject({ ok: true })
    expect(await s.run(CALL, undefined, other)).toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(await s.run(CALL, undefined, { ...phone, transport: 'relay' })).toMatchObject({ ok: true })
    s.executor.observeLive(s.target().ref, s.target().app, other)
    expect(await s.run(CALL, undefined, other)).toMatchObject({ ok: true })
  })

  it('caps pending approvals per View so another View can still ask, and expires old challenges', async () => {
    const s = setup({ fresh: true })
    const first = challenge(await s.run(MESSAGE))
    for (let i = 1; i < 8; i++) challenge(await s.run(MESSAGE))
    expect(await s.run(MESSAGE)).toMatchObject({ ok: false, error: { code: 'denied' } })
    const another = { ...s.target(), app: { ...s.target().app, appInstanceId: 'another' } }
    vi.mocked(s.ports.resolve).mockImplementation(async (_ref, id) => id === 'another' ? another : s.target())
    s.executor.observeLive(another.ref, another.app)
    challenge(await s.executor.execute({ ...s.request(MESSAGE), appInstanceId: 'another' }, REQUESTER, signal()))
    s.advance(300_001)
    challenge(await s.run(MESSAGE))
    expect(await s.run(MESSAGE, { challenge: first })).toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('bounds approval previews by UTF-8 bytes and renders source text without interpreting markup', async () => {
    const s = setup({ fresh: true })
    const result = await s.run({ operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: '<script>host()</script>' + '界'.repeat(2000) }] } })
    if (result.ok || result.error.code !== 'approval_required' || result.error.prompt.kind !== 'sendMessage') throw new Error('Expected message approval')
    expect(new TextEncoder().encode(result.error.prompt.text).byteLength).toBeLessThanOrEqual(4096)
    expect(result.error.prompt.text).toContain('<script>host()</script>')
    expect(result.error.prompt.text).not.toContain('\uFFFD')
  })

  it('reports transport loss as an unknown outcome without retry', async () => {
    const s = setup({ fresh: true })
    s.provider.mockImplementation(async (_target, operation) => {
      if (operation.operation === 'ready') return { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }
      if (operation.operation === 'tools') return { ok: true, value: [{ name: 'next_page' }] }
      throw new McpAppsError('not_connected', 'socket lost after dispatch')
    })
    expect(await s.run(CALL)).toMatchObject({ ok: true, value: { outcome: 'unknown_outcome', result: { isError: true } } })
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(1)
  })

  it.each(['not_connected', 'timeout', 'cancelled', 'unknown_outcome'] as const)('preserves a structured provider %s rejection without fabricating a tool result', async code => {
    const s = setup({ fresh: true })
    const original = s.provider.getMockImplementation()!
    const response = { ok: false as const, error: { code, message: 'Provider rejected this call' } }
    s.provider.mockImplementation(async (target, operation, abort) => operation.operation === 'callTool' ? response : original(target, operation, abort))
    expect(await s.run(CALL)).toEqual(response)
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(1)
  })

  it('cancels before dispatch if the document dies during catalog resolution', async () => {
    const s = setup({ fresh: true }); const controller = new AbortController()
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, operation, abort) => { if (operation.operation === 'tools') controller.abort(); return original(target, operation, abort) })
    expect(await s.executor.execute(s.request(CALL), REQUESTER, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })

  it('keeps a completed isError tool result and its private View metadata intact', async () => {
    const s = setup({ fresh: true })
    const response = { result: { content: [{ type: 'text', text: 'Unavailable' }], isError: true, _meta: { detail: 'view-only' } }, outcome: 'completed' }
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, operation, abort) => operation.operation === 'callTool' ? { ok: true, value: response } : original(target, operation, abort))
    expect(await s.run(CALL)).toEqual({ ok: true, value: response })
  })

  it('persists only the allowed context fields with host-authored source attribution', async () => {
    const s = setup({ fresh: true })
    expect(await s.run({ operation: 'updateModelContext', context: { structuredContent: { selected: 2 }, source: { appInstanceId: 'forged', server: 'forged' }, _meta: { secret: 'not-model' } } as never })).toMatchObject({ ok: true })
    expect(s.target().app.modelContext).toEqual({ structuredContent: { selected: 2 }, source: { appInstanceId: 'view', server: 'fixture' } })
  })

  it('confirms every View-authored message and rejects the removed main-process link operation', async () => {
    const s = setup({ fresh: true })
    await s.run(MESSAGE, { challenge: challenge(await s.run(MESSAGE)) })
    expect(s.ports.sendMessage).toHaveBeenCalledOnce()
    challenge(await s.run(MESSAGE))
    expect(await s.run({ operation: 'openLink', url: 'https://example.com' } as never)).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })

  it('caps admitted messages at three per View per minute in main', async () => {
    const s = setup({ fresh: true })
    const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }
    for (let i = 0; i < 3; i++) expect(await s.run(message, { challenge: challenge(await s.run(message)) })).toMatchObject({ ok: true })
    expect(await s.run(message, { challenge: challenge(await s.run(message)) })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).toHaveBeenCalledTimes(3)
  })
})
