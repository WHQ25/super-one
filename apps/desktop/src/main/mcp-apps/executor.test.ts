import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { SessionManagerImpl } from '../session/session-manager'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), provider: vi.fn(async () => ({ ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } })),
  external: vi.fn(),
}))
vi.mock('electron', () => ({ shell: { openExternal: mocks.external } }))
vi.mock('./provider-ipc', () => ({ routeMcpAppsProviderRequest: mocks.provider }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({
  connections: { listKnown: () => [{ connectionId: 'connection', environmentId: 'node' }] },
  resolveMcpAppAttachment: mocks.resolve,
  // No messages.list or session.get: the resolver must not request any transcript.
}) }))
import { executeMcpAppHostRequest, initializeMcpAppExecutor } from './executor'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', resource: { html: '<html>saved</html>', hash: 'hash', meta: {} } }
const session = { projectPath: '/project', snapshot: { messages: [{ id: 'm', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app }] }] } }
const manager = { getSession: () => session, onAny: vi.fn() } as unknown as SessionManagerImpl
const mobile = { handleRemoteCommand: vi.fn<Parameters<typeof initializeMcpAppExecutor>[1]['handleRemoteCommand']>(async (command, respond) => { await respond?.(command.requestId, { ok: true }) }), notifyEventSubscribers: vi.fn() }
initializeMcpAppExecutor(manager, mobile, vi.fn())

beforeEach(() => { mocks.resolve.mockReset(); mocks.provider.mockClear(); mobile.handleRemoteCommand.mockClear() })

describe('main MCP App executor adapters', () => {
  it('resolves a remote View in one scoped RPC without downloading session history', async () => {
    mocks.resolve.mockResolvedValueOnce({ ok: true, value: { projectId: '/node/project', messageId: 'authoritative-row', app: { ...app, binding: { ...app.binding, node: 'node' } }, sessionApprovals: [] } })
    expect(await executeMcpAppHostRequest({ sessionKey: 'connection:s', appInstanceId: 'view', messageId: 'stale-hint', operation: 'load' }, { kind: 'desktop' }))
      .toEqual({ ok: true, value: app.resource })
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('connection', { sessionId: 's', appInstanceId: 'view', messageId: 'stale-hint' })
    expect(mocks.provider).not.toHaveBeenCalled()
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
