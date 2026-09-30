import { describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { McpAppsError, MCP_APP_MIME_TYPE, type McpAppHostOperation, type McpAppHostRequest, type McpAppHostResult, type McpAppRequester, type McpToolDescriptor, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, mcpAppSessionApprovals, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'
import type { ChatMessage } from '@superone/shared/agent-types'

const APP: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', account: 'account', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result' }
const REQUESTER: McpAppRequester = { kind: 'desktop' }
const CALL: McpAppHostOperation = { operation: 'callTool', tool: 'next_page', args: { page: 2 } }
const signal = (): AbortSignal => new AbortController().signal

function setup(options: { snapshot?: boolean; fresh?: boolean; tools?: McpToolDescriptor[]; trusted?: boolean } = {}) {
  const app = structuredClone(APP)
  if (options.snapshot) app.resource = { html: '<html>restored</html>', hash: 'snapshot', meta: {} }
  let messages: ChatMessage[] = [{ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app }] }]
  let now = 1000
  const target = (): McpAppResolvedTarget => ({ ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', sessionApprovals: mcpAppSessionApprovals(messages), ...findMcpAppAttachment(messages, 'view')! })
  const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, operation) => {
    if (operation.operation === 'ready') return { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }
    if (operation.operation === 'tools') return { ok: true, value: options.tools ?? [{ name: 'next_page', _meta: { ui: { visibility: ['app'] } } }] }
    if (operation.operation === 'readResource') return { ok: true, value: { contents: [{ uri: operation.uri, mimeType: MCP_APP_MIME_TYPE, text: '<html>fresh</html>', _meta: { ui: { prefersBorder: true } } }] } }
    return { ok: true, value: { result: { content: [{ type: 'text', text: 'page 2' }], isError: false }, outcome: 'completed' } }
  })
  const ports: McpAppExecutorPorts = {
    resolve: vi.fn(async () => target()), provider,
    persist: vi.fn(async (_target, update) => { messages = updateMcpAppAttachments(messages, 'view', update) }),
    sendMessage: vi.fn(async () => {}), openLink: vi.fn(async () => {}), trustedServer: () => options.trusted ?? false, now: () => now,
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
    for (const operation of [CALL, { operation: 'readResource', uri: APP.resourceUri }, { operation: 'updateModelContext', context: { source: { appInstanceId: 'x', server: 'x' } } }, { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }, { operation: 'openLink', url: 'https://example.com' }] as McpAppHostOperation[]) {
      expect(await s.run(operation)).toMatchObject({ ok: false, error: { code: 'denied' } })
    }
    expect(s.provider).not.toHaveBeenCalled()
  })

  it('requires activation when restored HTML is missing, then persists a single load', async () => {
    const s = setup()
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: false, error: { code: 'denied' } })
    await s.run({ operation: 'activate' })
    const loaded = await s.run({ operation: 'load' })
    expect(loaded).toMatchObject({ ok: true, value: { html: '<html>fresh</html>', meta: { prefersBorder: true } } })
    expect(s.ports.persist).toHaveBeenCalledOnce()
    s.provider.mockClear()
    expect(await s.run({ operation: 'load' })).toEqual(loaded)
    expect(s.provider).not.toHaveBeenCalled()
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

  it('rejects model-only tools before call dispatch, and never trusts read-only hints alone', async () => {
    const blocked = setup({ fresh: true, tools: [{ name: 'next_page', _meta: { ui: { visibility: ['model'] } } }] })
    expect(await blocked.run()).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(blocked.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
    const readOnly = { name: 'next_page', annotations: { readOnlyHint: true } }
    challenge(await setup({ fresh: true, tools: [readOnly] }).run())
    expect(await setup({ fresh: true, tools: [readOnly], trusted: true }).run()).toMatchObject({ ok: true })
  })

  it('consumes a challenge exactly once, including simultaneous confirmations', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    const responses = await Promise.all([s.run(CALL, { challenge: id }), s.run(CALL, { challenge: id })])
    expect(responses.filter(result => result.ok)).toHaveLength(1)
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(1)
  })

  it.each(['args', 'requester', 'expiry', 'binding'] as const)('rejects a challenge after %s changes', async kind => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    if (kind === 'expiry') s.advance(300_001)
    if (kind === 'binding') { s.change({ binding: { ...APP.binding, account: 'other' } }); await s.run({ operation: 'activate' }) }
    const call = kind === 'args' ? { ...CALL, args: { page: 3 } } as McpAppHostOperation : CALL
    const requester = kind === 'requester' ? { kind: 'mobile' as const, deviceId: 'phone' } : REQUESTER
    expect(await s.run(call, { challenge: id }, requester)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })

  it('persists remembered tool consent scoped to session, node, server, configuration and account', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    await s.run(CALL, { challenge: id, remember: true })
    expect(s.target().app.approvedTools).toEqual([{ node: 'local', session: 's', server: 'fixture', account: 'account', configFingerprint: 'config', tool: 'next_page' }])
    expect(await s.run()).toMatchObject({ ok: true })
    s.change({ binding: { ...APP.binding, account: 'other' } })
    await s.run({ operation: 'activate' })
    challenge(await s.run())
  })

  it('accepts an outstanding challenge after another confirmation remembers consent', async () => {
    const s = setup({ fresh: true })
    const first = challenge(await s.run())
    const second = challenge(await s.run())
    expect(await s.run(CALL, { challenge: first, remember: true })).toMatchObject({ ok: true })
    expect(await s.run(CALL, { challenge: second })).toMatchObject({ ok: true })
    expect(await s.run(CALL, { challenge: second })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(2)
  })

  it('requires activation on each requester and keeps the same device active across transports', async () => {
    const s = setup({ snapshot: true, fresh: true })
    const phone: McpAppRequester = { kind: 'mobile', deviceId: 'phone', transport: 'lan' }
    const other: McpAppRequester = { kind: 'mobile', deviceId: 'other', transport: 'relay' }
    expect(await s.run(CALL, undefined, phone)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(await s.run({ operation: 'activate' }, undefined, phone)).toMatchObject({ ok: true })
    expect(await s.run(CALL, undefined, other)).toMatchObject({ ok: false, error: { code: 'denied' } })
    const id = challenge(await s.run(CALL, undefined, phone))
    expect(await s.run(CALL, { challenge: id }, { ...phone, transport: 'relay' })).toMatchObject({ ok: true })
    s.executor.observeLive(s.target().ref, s.target().app, other)
    challenge(await s.run(CALL, undefined, other))
  })

  it('caps pending approvals per View so another View can still ask, and expires old challenges', async () => {
    const s = setup({ fresh: true })
    const first = challenge(await s.run())
    for (let i = 1; i < 8; i++) challenge(await s.run())
    expect(await s.run()).toMatchObject({ ok: false, error: { code: 'denied' } })
    const another = { ...s.target(), app: { ...s.target().app, appInstanceId: 'another' } }
    vi.mocked(s.ports.resolve).mockImplementation(async (_ref, id) => id === 'another' ? another : s.target())
    s.executor.observeLive(another.ref, another.app)
    challenge(await s.executor.execute({ ...s.request(), appInstanceId: 'another' }, REQUESTER, signal()))
    s.advance(300_001)
    challenge(await s.run())
    expect(await s.run(CALL, { challenge: first })).toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('bounds approval previews by UTF-8 bytes and renders source text without interpreting markup', async () => {
    const s = setup({ fresh: true })
    const result = await s.run({ operation: 'callTool', tool: 'next_page', args: { html: '<script>host()</script>', text: '界'.repeat(2000) } })
    if (result.ok || result.error.code !== 'approval_required' || result.error.prompt.kind !== 'callTool') throw new Error('Expected tool approval')
    expect(new TextEncoder().encode(result.error.prompt.argsPreview).byteLength).toBeLessThanOrEqual(2048)
    expect(result.error.prompt.argsPreview).toContain('<script>host()</script>')
    expect(result.error.prompt.argsPreview).not.toContain('\uFFFD')
  })

  it('reports transport loss as an unknown outcome without retry', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    s.provider.mockImplementation(async (_target, operation) => {
      if (operation.operation === 'ready') return { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }
      if (operation.operation === 'tools') return { ok: true, value: [{ name: 'next_page' }] }
      throw new McpAppsError('not_connected', 'socket lost after dispatch')
    })
    expect(await s.run(CALL, { challenge: id })).toMatchObject({ ok: true, value: { outcome: 'unknown_outcome', result: { isError: true } } })
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(1)
  })

  it.each(['not_connected', 'timeout', 'cancelled', 'unknown_outcome'] as const)('preserves a structured provider %s rejection without fabricating a tool result', async code => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    const original = s.provider.getMockImplementation()!
    const response = { ok: false as const, error: { code, message: 'Provider rejected this call' } }
    s.provider.mockImplementation(async (target, operation, abort) => operation.operation === 'callTool' ? response : original(target, operation, abort))
    expect(await s.run(CALL, { challenge: id })).toEqual(response)
    expect(s.provider.mock.calls.filter(([, op]) => op.operation === 'callTool')).toHaveLength(1)
  })

  it('cancels before dispatch if the document dies while remembered consent is persisted', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    const controller = new AbortController()
    vi.mocked(s.ports.persist).mockImplementation(async () => { controller.abort() })
    expect(await s.executor.execute(s.request(CALL, { challenge: id, remember: true }), REQUESTER, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.provider.mock.calls.some(([, op]) => op.operation === 'callTool')).toBe(false)
  })

  it('keeps a completed isError tool result and its private View metadata intact', async () => {
    const s = setup({ fresh: true })
    const id = challenge(await s.run())
    const response = { result: { content: [{ type: 'text', text: 'Unavailable' }], isError: true, _meta: { detail: 'view-only' } }, outcome: 'completed' }
    const original = s.provider.getMockImplementation()!
    s.provider.mockImplementation(async (target, operation, abort) => operation.operation === 'callTool' ? { ok: true, value: response } : original(target, operation, abort))
    expect(await s.run(CALL, { challenge: id })).toEqual({ ok: true, value: response })
  })

  it('persists only the allowed context fields with host-authored source attribution', async () => {
    const s = setup({ fresh: true })
    expect(await s.run({ operation: 'updateModelContext', context: { structuredContent: { selected: 2 }, source: { appInstanceId: 'forged', server: 'forged' }, _meta: { secret: 'not-model' } } as never })).toMatchObject({ ok: true })
    expect(s.target().app.modelContext).toEqual({ structuredContent: { selected: 2 }, source: { appInstanceId: 'view', server: 'fixture' } })
  })

  it('confirms every message and every desktop link; mobile links are denied', async () => {
    const s = setup({ fresh: true })
    const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'Selected page 2' }] } }
    const id = challenge(await s.run(message))
    await s.run(message, { challenge: id })
    expect(s.ports.sendMessage).toHaveBeenCalledOnce()
    challenge(await s.run(message))
    const link: McpAppHostOperation = { operation: 'openLink', url: 'https://example.com/' }
    await s.run(link, { challenge: challenge(await s.run(link)) })
    expect(s.ports.openLink).toHaveBeenCalledWith('https://example.com/')
    challenge(await s.run(link))
    expect(await s.run(link, undefined, { kind: 'mobile', deviceId: 'phone' })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(await s.run({ operation: 'openLink', url: 'file:///etc/passwd' })).toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('caps admitted messages at three per View per minute in main', async () => {
    const s = setup({ fresh: true })
    const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }
    for (let i = 0; i < 3; i++) expect(await s.run(message, { challenge: challenge(await s.run(message)) })).toMatchObject({ ok: true })
    expect(await s.run(message, { challenge: challenge(await s.run(message)) })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).toHaveBeenCalledTimes(3)
  })
})
