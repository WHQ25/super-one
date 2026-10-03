import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { SessionManagerImpl } from '../session/session-manager'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), provider: vi.fn(async () => ({ ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } })),
  external: vi.fn(),
  remoteSession: vi.fn(), createRemoteSession: vi.fn(), remoteSend: vi.fn(),
}))
vi.mock('electron', () => ({ shell: { openExternal: mocks.external } }))
vi.mock('./provider-ipc', () => ({ routeMcpAppsProviderRequest: mocks.provider }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({
  connections: { listKnown: () => [{ connectionId: 'connection', environmentId: 'node' }] },
  resolveMcpAppAttachment: mocks.resolve,
  getSession: mocks.remoteSession, createSession: mocks.createRemoteSession, sendSessionMessage: mocks.remoteSend,
}) }))
import { executeMcpAppHostRequest, initializeMcpAppExecutor, isMcpAppHostActive, releaseMcpAppRequester, resolveMcpAppHostAttachment } from './executor'
import { notifySessionClosed, notifySessionsDeleted } from '../session-list-watch'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
  presentation: { toolTitle: 'Library', serverTitle: 'Fixture CAD' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', resource: { html: '<html>saved</html>', hash: 'hash', meta: {} } }
const send = vi.fn(async (_request, callbacks) => { callbacks.onAccepted() })
const newSession = { id: 'new', send, snapshot: { harnessId: 'claude' }, broadcastSettingsPatch: vi.fn() }
const createSession = vi.fn(() => newSession)
const session = { getUiSettings: () => ({ selectedModel: 'sonnet', selectedEffort: 'high', permissionMode: 'auto', sandboxInfo: { enabled: true, autoAllowBash: true } }), getCurrentSandboxInfo: () => ({ enabled: true, autoAllowBash: true }), getCurrentPermissionMode: () => 'auto', getSelectedEffort: () => 'high', projectPath: '/project', send, snapshot: { projectPath: '/project', cwd: '/project/worktree', gitBranch: 'feature', harnessId: 'claude', acpAgentId: null, selectedModel: 'sonnet', selectedEffort: 'high', providerId: 'claude-base', apiProviderId: 'account', messages: [{ id: 'm', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app }] }] } }
const manager = { getSession: (id: string) => id === 'new' ? newSession : session, createSession, onAny: vi.fn() } as unknown as SessionManagerImpl
const mobile = { handleRemoteCommand: vi.fn<Parameters<typeof initializeMcpAppExecutor>[1]['handleRemoteCommand']>(async (command, respond) => { await respond?.(command.requestId, { ok: true }) }), notifyEventSubscribers: vi.fn() }
initializeMcpAppExecutor(manager, mobile, vi.fn())

beforeEach(() => { mocks.resolve.mockReset(); mocks.provider.mockClear(); mobile.handleRemoteCommand.mockClear(); send.mockClear(); createSession.mockClear(); mocks.remoteSession.mockReset(); mocks.createRemoteSession.mockReset(); mocks.remoteSend.mockReset() })

describe('main MCP App executor adapters', () => {
  it('auto-activates every child View on a live collab event, but never on replay', async () => {
    const children = ['first-child', 'second-child'].map(id => ({ id, type: 'mcp_tool_call' as const, server: 'fixture', tool: 'next', arguments: {}, status: 'completed' as const, app: { ...app, appInstanceId: id, origin: { providerSessionId: id } } }))
    const item = { id: 'spawn', type: 'collab_tool_call' as const, tool: 'spawnAgent' as const, status: 'completed' as const, receiverThreadIds: ['child'], agentsStates: {}, childItems: { child: children } }
    const row = { id: 'parent', content: [], metadata: { codex: { items: [item] } } }
    session.snapshot.messages.push(row as unknown as typeof session.snapshot.messages[number])
    try {
      const notify = (manager.onAny as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      const event = { type: 'codex_item_delta', messageId: 'parent', phase: 'updated', item }
      notify('s', event, true)
      for (const child of children) expect(isMcpAppHostActive(await resolveMcpAppHostAttachment({ sessionKey: 'local:s', appInstanceId: child.id }))).toBe(false)
      notify('s', event, false)
      for (const child of children) expect(isMcpAppHostActive(await resolveMcpAppHostAttachment({ sessionKey: 'local:s', appInstanceId: child.id }))).toBe(true)
    } finally {
      session.snapshot.messages.pop()
      notifySessionClosed({ environmentId: 'local', sessionId: 's' })
    }
  })

  it.each(['close', 'delete', 'disconnect'])('requires reactivation after %s tears down its owner scope', async reason => {
    const requester = { kind: 'mobile' as const, deviceId: 'cleanup-phone' }
    const identity = { sessionKey: 'local:s', appInstanceId: 'view' }
    await executeMcpAppHostRequest({ ...identity, operation: 'activate' }, requester)
    if (reason === 'close') notifySessionClosed({ environmentId: 'local', sessionId: 's' })
    else if (reason === 'delete') notifySessionsDeleted(['s'])
    else releaseMcpAppRequester(requester)
    const result = await executeMcpAppHostRequest({ ...identity, operation: 'sendMessage', params: { role: 'user', content: [] } }, requester)
    expect(result).toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(mobile.handleRemoteCommand).not.toHaveBeenCalled()
  })

  it('resolves a remote View in one scoped RPC without downloading session history', async () => {
    mocks.resolve.mockResolvedValueOnce({ ok: true, value: { projectId: '/node/project', messageId: 'authoritative-row', app: { ...app, binding: { ...app.binding, node: 'node' } } } })
    expect(await executeMcpAppHostRequest({ sessionKey: 'connection:s', appInstanceId: 'view', messageId: 'stale-hint', operation: 'load' }, { kind: 'desktop' }))
      .toEqual({ ok: true, value: app.resource })
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('connection', { sessionId: 's', appInstanceId: 'view', messageId: 'stale-hint' })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.remoteSession).not.toHaveBeenCalled()
  })

  it('creates a desktop destination using the source project and harness provider, then preserves rich input', async () => {
    const requester = { kind: 'desktop' as const }
    await executeMcpAppHostRequest({ sessionKey: 'local:s', appInstanceId: 'view', operation: 'activate' }, requester)
    const request = { sessionKey: 'local:s', appInstanceId: 'view', operation: 'sendMessage' as const, params: { role: 'user' as const, content: [
      { type: 'text' as const, text: '{"part":"dial"}', _meta: { 'openai/title': 'Dial', private: 'secret' } },
      { type: 'image' as const, mimeType: 'image/png', data: 'iVBORw0KGgo=', _meta: { 'openai/title': 'Drawing' } },
    ], _meta: { 'openai/message': { target: 'new' } } } }
    const prompt = await executeMcpAppHostRequest(request, requester)
    if (prompt.ok || prompt.error.code !== 'approval_required') throw new Error('Expected approval')
    expect(prompt.error.prompt).toMatchObject({ server: 'Fixture CAD', items: [expect.objectContaining({ source: 'Fixture CAD' }), expect.objectContaining({ source: 'Fixture CAD' })] })
    const prepared = await executeMcpAppHostRequest({ ...request, approval: { challenge: prompt.error.challenge } }, requester)
    if (!prepared.ok) throw new Error('Expected handoff')
    expect(createSession).toHaveBeenCalledExactlyOnceWith({ projectPath: '/project', cwd: '/project/worktree', gitBranch: 'feature', providerId: 'claude-base', apiProviderId: 'account', model: 'sonnet', effort: 'high', permissionMode: 'auto', sandboxMode: 'auto', acpAgentId: null, codexServiceTier: undefined })
    expect(newSession.broadcastSettingsPatch).toHaveBeenCalledWith(session.getUiSettings())
    expect(send).not.toHaveBeenCalled()
    const pendingSend = (prepared.value as { pendingSend: string }).pendingSend
    expect(await executeMcpAppHostRequest({ sessionKey: 'local:s', appInstanceId: 'view', operation: 'sendPreparedMessage', pendingSend }, requester)).toMatchObject({ ok: true })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: '[MCP App: fixture]\n{"part":"dial"}', images: [expect.objectContaining({ name: 'Drawing', mimeType: 'image/png', base64: 'iVBORw0KGgo=' })], userMessageContent: [expect.objectContaining({ type: 'image', name: 'Drawing' })], contexts: [expect.objectContaining({ appName: 'Fixture CAD', summary: 'Dial', content: '{"part":"dial"}' })] }), expect.any(Object))
  })

  it('creates remote new conversations from authoritative node project/provider/harness settings', async () => {
    mocks.resolve.mockResolvedValue({ ok: true, value: { projectId: 'project', messageId: 'm', app: { ...app, binding: { ...app.binding, node: 'node' } } } })
    mocks.remoteSession.mockResolvedValue({ projectId: 'project', providerId: 'claude-personal', harnessId: 'claude', cwd: '/node/worktree', model: 'sonnet', effort: 'high', permissionMode: 'auto', sandboxMode: 'on', apiProviderId: 'account' })
    mocks.createRemoteSession.mockResolvedValue({ sessionId: 'new-remote' })
    mocks.remoteSend.mockImplementation(async (_connection, input) => { input.onAccepted() })
    const requester = { kind: 'desktop' as const }
    const identity = { sessionKey: 'connection:s', appInstanceId: 'view' }
    await executeMcpAppHostRequest({ ...identity, operation: 'activate' }, requester)
    const request = { ...identity, operation: 'sendMessage' as const, params: { role: 'user' as const, content: [{ type: 'text' as const, text: 'compare' }], _meta: { 'openai/message': { target: 'new' } } } }
    const prompt = await executeMcpAppHostRequest(request, requester)
    if (prompt.ok || prompt.error.code !== 'approval_required') throw new Error('Expected approval')
    const prepared = await executeMcpAppHostRequest({ ...request, approval: { challenge: prompt.error.challenge } }, requester)
    if (!prepared.ok) throw new Error('Expected handoff')
    expect(mocks.createRemoteSession).toHaveBeenCalledExactlyOnceWith('connection', { projectId: 'project', providerId: 'claude-personal', harnessId: 'claude', cwd: '/node/worktree', settings: { model: 'sonnet', effort: 'high', permissionMode: 'auto', sandboxMode: 'on', apiProviderId: 'account' } })
    expect(await executeMcpAppHostRequest({ ...identity, operation: 'sendPreparedMessage', pendingSend: (prepared.value as { pendingSend: string }).pendingSend }, requester)).toMatchObject({ ok: true })
    expect(mocks.remoteSend).toHaveBeenCalledWith('connection', expect.objectContaining({ sessionId: 'new-remote', projectPath: 'remote:connection:project', echoUserMessage: true, userMessageContent: [{ type: 'text', text: 'compare' }] }))
  })

  it('sends an approved phone message through the normal queue with its real relay source', async () => {
    const requester = { kind: 'mobile' as const, deviceId: 'phone', transport: 'relay' as const }
    await executeMcpAppHostRequest({ sessionKey: 'local:s', appInstanceId: 'view', operation: 'activate' }, requester)
    const request = { sessionKey: 'local:s', appInstanceId: 'view', operation: 'sendMessage' as const, params: { role: 'user' as const, content: [{ type: 'text' as const, text: 'selected page 2' }] } }
    const prompt = await executeMcpAppHostRequest(request, requester)
    if (prompt.ok || prompt.error.code !== 'approval_required') throw new Error('Expected approval')
    expect(await executeMcpAppHostRequest({ ...request, approval: { challenge: prompt.error.challenge } }, requester)).toMatchObject({ ok: true })
    expect(mobile.handleRemoteCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'send_message', priority: 'next', sessionId: 's', projectPath: '/project', content: '[MCP App: fixture]\nselected page 2' }), expect.any(Function), { deviceId: 'phone', transport: 'relay' })
  })
})
