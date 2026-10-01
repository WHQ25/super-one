import { describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { McpAppsError, MCP_APP_MIME_TYPE, type McpAppHostOperation, type McpAppHostRequest, type McpAppHostResult, type McpAppRequester, type McpToolDescriptor, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
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
  const tools = vi.fn(async () => new Map<string, McpToolDescriptor>((options.tools ?? [{ name: 'next_page', _meta: { ui: { visibility: ['app'] } } }]).map(tool => [tool.name, tool])))
  const callTool = vi.fn(async () => ({ result: { content: [{ type: 'text', text: 'page 2' }], isError: false }, outcome: 'completed' as const }))
  const provider = vi.fn<McpAppExecutorPorts['provider']>((target, operation, abort) => dispatchMcpAppsProviderRequest({ ...operation, binding: target.app.binding, origin: target.app.origin! }, {
    binding: target.app.binding, tools, callTool,
    async ready() { return { mode: 'native', resourceRead: true, toolCall: true } },
    async readResource(req) { return { contents: [{ uri: req.uri, mimeType: MCP_APP_MIME_TYPE, text: '<html>fresh</html>', _meta: { ui: { prefersBorder: true } } }] } },
    dispose() {},
  }, abort))
  const ports: McpAppExecutorPorts = {
    resolve: vi.fn(async () => target()), provider,
    persist: vi.fn(async (_target, update) => { messages = updateMcpAppAttachments(messages, 'view', update) }),
    sendMessage: vi.fn(async () => {}), now: () => now,
  }
  const executor = new McpAppExecutor(ports)
  if (options.fresh) executor.observeLive(target().ref, app)
  const request = (operation: McpAppHostOperation = CALL, approval?: McpAppHostRequest['approval']): McpAppHostRequest => ({ sessionKey: 'local:s', appInstanceId: 'view', messageId: 'm', ...operation, ...(approval ? { approval } : {}) })
  const run = (operation: McpAppHostOperation = CALL, approval?: McpAppHostRequest['approval'], requester = REQUESTER) => executor.execute(request(operation, approval), requester, signal())
  return { executor, ports, provider, tools, callTool, run, request, target, change: (patch: Partial<ToolAppAttachment>) => { messages = messages.map(message => ({ ...message, content: message.content.map(block => 'app' in block && block.app ? { ...block, app: { ...block.app, ...patch } } : block) })) }, advance: (ms: number) => { now += ms } }
}

function challenge(result: McpAppHostResult): string {
  expect(result).toMatchObject({ ok: false, error: { code: 'approval_required' } })
  if (result.ok || result.error.code !== 'approval_required') throw new Error('Expected approval')
  return result.error.challenge
}

describe('MCP App host executor', () => {
  it('returns retained maps to baseline after session churn and keeps a live View active', async () => {
    const s = setup({ fresh: true })
    const counts = () => {
      const state = s.executor as unknown as { active: Map<string, string>; messageTimes: Map<string, number[]>; challenges: Map<string, unknown>; pendingSends: Map<string, unknown>; requests: Set<unknown> }
      return [state.active.size, state.messageTimes.size, state.challenges.size, state.pendingSends.size, state.requests.size]
    }
    const baseline = counts()
    s.ports.resolve = async ref => ({ ...s.target(), ref, app: { ...APP, binding: { ...APP.binding, session: ref.sessionId } } })
    for (let i = 0; i < 100; i++) {
      const ref = { environmentId: 'local', sessionId: `closed-${i}` }
      const app = { ...APP, binding: { ...APP.binding, session: ref.sessionId } }
      const requester: McpAppRequester = { kind: 'mobile', deviceId: `device-${i}` }
      s.executor.observeLive(ref, app, requester)
      const request = { ...s.request(MESSAGE), sessionKey: `local:${ref.sessionId}` }
      const prompt = await s.executor.execute(request, requester, signal())
      expect(await s.executor.execute({ ...request, approval: { challenge: challenge(prompt) } }, requester, signal())).toMatchObject({ ok: true })
      challenge(await s.executor.execute(request, requester, signal()))
      s.executor.releaseSession(ref)
      expect(counts()).toEqual(baseline)
    }
    expect(s.executor.isActive(s.target())).toBe(true)
  })

  it('releases only the disconnected requester and invalidates its pending approval', async () => {
    const s = setup({ fresh: true })
    const phone: McpAppRequester = { kind: 'mobile', deviceId: 'phone' }
    const other: McpAppRequester = { kind: 'mobile', deviceId: 'other' }
    await s.run({ operation: 'activate' }, undefined, phone)
    await s.run({ operation: 'activate' }, undefined, other)
    const approval = challenge(await s.run(MESSAGE, undefined, phone))
    s.executor.releaseRequester(phone)
    expect(s.executor.isActive(s.target(), phone)).toBe(false)
    expect(s.executor.isActive(s.target(), other)).toBe(true)
    expect(s.executor.isActive(s.target())).toBe(true)
    await s.run({ operation: 'activate' }, undefined, phone)
    expect(await s.run(MESSAGE, { challenge: approval }, phone)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
  })

  it('expires idle rate-limit keys without evicting a quiet live activation', async () => {
    const s = setup({ fresh: true })
    await s.run(MESSAGE, { challenge: challenge(await s.run(MESSAGE)) })
    const state = s.executor as unknown as { messageTimes: Map<string, number[]> }
    expect(state.messageTimes.size).toBe(1)
    s.advance(60_001); s.executor.sweepExpired()
    expect(state.messageTimes.size).toBe(0)
    expect(s.executor.isActive(s.target())).toBe(true)
    expect(await s.run(CALL)).toMatchObject({ ok: true })
  })

  it('cannot reactivate a closed scope when an in-flight ready reply arrives late', async () => {
    const s = setup()
    let finish!: (value: Awaited<ReturnType<McpAppExecutorPorts['provider']>>) => void
    s.provider.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const activation = s.run({ operation: 'activate' })
    await vi.waitFor(() => expect(s.provider).toHaveBeenCalledOnce())
    s.executor.releaseSession(s.target().ref)
    finish({ ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } })
    expect(await activation).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.executor.isActive(s.target())).toBe(false)
  })

  it.each(['source', 'destination'])('drops a prepared message when its %s session closes', async owner => {
    const s = setup({ fresh: true })
    const destination = { environmentId: 'local', sessionId: 'new' }
    s.ports.createMessageSession = async () => ({ ref: destination, projectPath: '/project' })
    const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [], _meta: { 'openai/message': { target: 'new' } } } }
    const result = await s.run(message, { challenge: challenge(await s.run(message)) })
    if (!result.ok) throw new Error('Expected prepared message')
    s.executor.releaseSession(owner === 'source' ? s.target().ref : destination)
    const state = s.executor as unknown as { pendingSends: Map<string, unknown> }
    expect(state.pendingSends.size).toBe(0)
    await s.run({ operation: 'sendPreparedMessage', pendingSend: (result.value as { pendingSend: string }).pendingSend })
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
  })

  it('creates a confirmed new session, then sends only after a single-use host handoff', async () => {
    const s = setup({ fresh: true })
    s.ports.createMessageSession = vi.fn(async () => ({ ref: { environmentId: 'local', sessionId: 'new' }, projectPath: '/project' }))
    const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'Selected page 2' }], _meta: { 'openai/message': { target: 'new' } } } }
    const prompt = await s.run(message)
    expect(prompt).toMatchObject({ error: { prompt: { target: 'new' } } })
    expect(s.ports.createMessageSession).not.toHaveBeenCalled()
    const prepared = await s.run(message, { challenge: challenge(prompt) })
    if (!prepared.ok) throw new Error('Expected pending send')
    const value = prepared.value as { pendingSend: string; route: unknown }
    expect(value.route).toEqual({ projectPath: '/project', sessionId: 'new' })
    expect(s.ports.createMessageSession).toHaveBeenCalledOnce()
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
    expect(await s.run({ operation: 'sendPreparedMessage', pendingSend: value.pendingSend })).toMatchObject({ ok: true })
    expect(s.ports.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ ref: { environmentId: 'local', sessionId: 'new' }, projectPath: '/project' }), expect.any(Object), REQUESTER, expect.any(AbortSignal))
    expect(await s.run({ operation: 'sendPreparedMessage', pendingSend: value.pendingSend })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.ports.sendMessage).toHaveBeenCalledOnce()
  })

  it('refuses phone new-session messages before approval and rejects send:false', async () => {
    const s = setup({ fresh: true })
    const phone: McpAppRequester = { kind: 'mobile', deviceId: 'phone' }
    await s.run({ operation: 'activate' }, undefined, phone)
    for (const options of [{ target: 'new' }, { send: false }]) {
      const operation: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [], _meta: { 'openai/message': options } } }
      const result = await s.run(operation, undefined, phone)
      expect(result).toMatchObject({ ok: false, error: { code: options.send === false ? 'invalid' : 'denied' } })
    }
    expect(s.ports.sendMessage).not.toHaveBeenCalled()
  })

  it('refuses expired handoffs, changed bindings, and phone attempts without dispatching', async () => {
    for (const refuse of ['expiry', 'binding', 'phone']) {
      const s = setup({ fresh: true })
      s.ports.createMessageSession = async () => ({ ref: { environmentId: 'local', sessionId: 'new' }, projectPath: '/project' })
      const message: McpAppHostOperation = { operation: 'sendMessage', params: { role: 'user', content: [], _meta: { 'openai/message': { target: 'new' } } } }
      const prepared = await s.run(message, { challenge: challenge(await s.run(message)) })
      if (!prepared.ok) throw new Error('Expected handoff')
      if (refuse === 'expiry') s.advance(300_001)
      if (refuse === 'binding') s.change({ binding: { ...APP.binding, configFingerprint: 'changed' } })
      const requester: McpAppRequester = refuse === 'phone' ? { kind: 'mobile', deviceId: 'phone' } : REQUESTER
      const result = await s.run({ operation: 'sendPreparedMessage', pendingSend: (prepared.value as { pendingSend: string }).pendingSend }, undefined, requester)
      expect(result).toMatchObject({ ok: false, error: { code: 'denied' } })
      expect(s.ports.sendMessage).not.toHaveBeenCalled()
    }
  })
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
    expect(vi.mocked(s.ports.persist).mock.calls.filter(([, update]) => update.resource)).toHaveLength(1)
    s.provider.mockClear()
    expect(await s.run({ operation: 'load' })).toEqual(loaded)
    expect(s.provider).not.toHaveBeenCalled()
  })

  it('persists tool and server presentation with the resource snapshot', async () => {
    const s = setup({ fresh: true, tools: [{ name: 'library', title: 'Library', serverInfo: { title: 'CAD', icons: [{ src: 'https://example.com/cad.png' }] } }] })
    s.change({ toolName: 'library' })
    await s.run({ operation: 'load' })
    await vi.waitFor(() => expect(s.target().app.presentation).toEqual({ toolTitle: 'Library', serverTitle: 'CAD', icons: [{ src: 'https://example.com/cad.png' }] }))
  })

  it.each([false, true])('paints before slow presentation discovery and discards changed bindings (%s)', async changeBinding => {
    const s = setup({ fresh: true })
    let finish!: (tools: Map<string, McpToolDescriptor>) => void
    s.tools.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    s.change({ toolName: 'library' })
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: true, value: { html: '<html>fresh</html>' } })
    expect(s.target().app.resource?.meta).toEqual({ prefersBorder: true })
    expect(s.target().app.presentation).toBeUndefined()
    if (changeBinding) s.change({ binding: { ...APP.binding, configFingerprint: 'new-config' } })
    finish(new Map([['library', { name: 'library', title: 'Library' }]]))
    await vi.waitFor(() => expect(s.tools).toHaveResolved())
    if (changeBinding) expect(s.target().app.presentation).toBeUndefined()
    else await vi.waitFor(() => expect(s.target().app.presentation?.toolTitle).toBe('Library'))
  })

  it('keeps valid resource HTML when optional presentation discovery fails', async () => {
    const s = setup({ fresh: true })
    s.tools.mockRejectedValue(new Error('Catalog unavailable'))
    expect(await s.run({ operation: 'load' })).toMatchObject({ ok: true, value: { html: '<html>fresh</html>' } })
    await expect(s.tools.mock.results[0].value).rejects.toThrow('Catalog unavailable')
    expect(s.target().app.resource?.html).toBe('<html>fresh</html>')
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
    expect(s.tools).toHaveBeenCalledTimes(1)
    s.tools.mockResolvedValue(new Map([['next_page', { name: 'next_page', _meta: { ui: { visibility: ['model'] } } }]]))
    expect(await s.run(CALL, undefined, requester)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(s.callTool).toHaveBeenCalledTimes(1)
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
    s.tools.mockImplementation(async () => { controller.abort(); return new Map([['next_page', { name: 'next_page' }]]) })
    expect(await s.executor.execute(s.request(CALL), REQUESTER, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(s.callTool).not.toHaveBeenCalled()
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
    expect(s.target().app.modelContext).toEqual({ structuredContent: { selected: 2 }, source: { appInstanceId: 'view', server: 'fixture' }, updateId: expect.any(String) })
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

describe('MCP App model context revisions and composer removal', () => {
  const update: McpAppHostOperation = { operation: 'updateModelContext', context: { content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }, { type: 'text', text: 'background', annotations: { audience: ['assistant'] } }], structuredContent: { selected: true }, source: { appInstanceId: '', server: '' } } }
  it('returns durable IDs, keeps identical updates idempotent and rejects stale removal after replacement', async () => {
    const s = setup({ fresh: true })
    const first = await s.run(update)
    expect(first).toMatchObject({ ok: true, value: { updateId: expect.any(String) } })
    const id = s.target().app.modelContext!.updateId!
    expect(await s.run(update)).toMatchObject({ ok: true, value: { updateId: id } })
    await s.run({ operation: 'updateModelContext', context: { ...update.context, content: [{ type: 'text', text: 'replacement' }] } })
    expect(s.target().app.modelContext!.updateId).not.toBe(id)
    expect(await s.run({ operation: 'removeModelContext', updateId: id, blockIndex: 0 })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(s.target().app.modelContext!.content).toEqual([{ type: 'text', text: 'replacement' }])
  })
  it.each([{ kind: 'desktop' }, { kind: 'mobile', deviceId: 'phone' }] as const)('removes $kind history context without activating or contacting the provider', async requester => {
    const s = setup()
    s.change({ origin: undefined, modelContext: { ...update.context, updateId: 'old' } })
    expect(await s.run({ operation: 'removeModelContext', updateId: 'old', blockIndex: 0 }, undefined, requester)).toMatchObject({ ok: true, value: { updateId: expect.any(String) } })
    expect(s.provider).not.toHaveBeenCalled()
    const id = s.target().app.modelContext!.updateId!
    expect(s.target().app.modelContext!.content).toHaveLength(2)
    expect(await s.run({ operation: 'removeModelContext', updateId: id, blockIndex: 0 }, undefined, requester)).toEqual({ ok: true, value: null })
    expect(s.target().app.modelContext).toBeNull()
    expect(s.provider).not.toHaveBeenCalled()
  })
  it('serializes competing removals so the same old revision cannot remove a second block', async () => {
    const s = setup()
    s.change({ modelContext: { ...update.context, updateId: 'old' } })
    const results = await Promise.all([0, 1].map(blockIndex => s.run({ operation: 'removeModelContext', updateId: 'old', blockIndex })))
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(s.target().app.modelContext!.content).toHaveLength(2)
  })
  it('bounds a blocked context write backlog before it can retain unbounded payloads', async () => {
    const s = setup()
    s.change({ modelContext: { ...update.context, updateId: 'old' } })
    let unblock!: () => void
    const blocked = new Promise<void>(resolve => { unblock = resolve })
    const persist = s.ports.persist as ReturnType<typeof vi.fn>
    const original = persist.getMockImplementation()!
    persist.mockImplementationOnce(async (...args: unknown[]) => { await blocked; return original(...args) })
    const pending = Array.from({ length: 33 }, () => s.run({ operation: 'removeModelContext', updateId: 'old', blockIndex: 0 }))
    await expect(pending[32]).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    unblock()
    await Promise.all(pending)
  })

  it('clears an empty replacement and refuses invalid image content before persistence', async () => {
    const s = setup({ fresh: true })
    await s.run(update)
    expect(await s.run({ operation: 'updateModelContext', context: { content: [], source: { appInstanceId: '', server: '' } } })).toEqual({ ok: true, value: null })
    expect(s.target().app.modelContext).toBeNull()
    expect(await s.run({ operation: 'updateModelContext', context: { content: [{ type: 'image', mimeType: 'image/png', data: 'invalid' }], source: { appInstanceId: '', server: '' } } })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(s.target().app.modelContext).toBeNull()
  })
})
