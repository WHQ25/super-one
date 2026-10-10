import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlLease, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import type { McpAppHostResult, ToolAppAttachment } from '@superone/shared/mcp-apps'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { McpAppExecutor } from '../../mcp-apps/executor-core'
import { createPhoneMethods, type PhoneMethodHost } from '../../remote/phone-methods'
import { sendPhoneMcpAppMessage } from '../../session/mcp-app-send'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

function appDomain() {
  let result: ReturnType<typeof phoneDomain>
  let app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 'own', server: 'fixture', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'provider' }, resourceUri: 'ui://fixture/view', status: 'result', resource: { html: '<html>saved</html>', hash: 'a'.repeat(64), meta: {} } }
  const persist = vi.fn(async (_target, update) => { app = { ...app, ...update } })
  const provider = vi.fn(async (_target, operation) => operation.operation === 'ready' ? { ok: true as const, value: { mode: 'native', resourceRead: true, toolCall: true } } : { ok: true as const, value: { outcome: 'known', result: { content: [] } } })
  const executor = new McpAppExecutor({
    resolve: async (ref, appInstanceId) => {
      if (ref.sessionId !== 'own' || appInstanceId !== 'view') throw new Error('App not found')
      return { ref, node: 'local', projectPath: result.projectDir, messageId: 'm', app }
    },
    persist, provider,
    sendMessage: async (target, params, requester) => {
      if (requester.kind !== 'mobile') throw new Error('Expected a phone')
      await sendPhoneMcpAppMessage(result.sessions, { sessionId: target.ref.sessionId, projectPath: target.projectPath,
        request: { content: JSON.stringify(params.content), clientMessageId: 'app-send', priority: 'next' } },
      { deviceId: requester.deviceId, transport: requester.transport! }, () => {})
    },
  })
  const request = vi.fn<NonNullable<PhoneMethodHost['mcpAppsRequest']>>((request, requester, signal, validateTarget) => executor.execute(request, requester, signal, validateTarget))
  result = phoneDomain(cleanup, { phoneMethods: createPhoneMethods({ agent: {} as PhoneMethodHost['agent'], mcpAppsRequest: request }) })
  return { ...result, executor, provider, persist, request }
}

describe('phone endpoint: MCP Apps', () => {
  it.each(['lan', 'relay'] as const)('uses authenticated View identity and sends an approved message exactly once over %s', async (transport) => {
    const { domain, own, request } = appDomain()
    const phone = await connectPhone(domain, { transport })
    cleanup.push(phone.close)
    const descriptor = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(descriptor.capabilities.methods).toContain('mcpApps.request')
    const payload = { sessionId: 'own', request: { appInstanceId: 'view', operation: 'load', sessionKey: 'local:forged', deviceId: 'forged' } }
    expect(await phone.rpc('mcpApps.request', payload)).toMatchObject({ ok: true, value: { html: '<html>saved</html>' } })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: 'local:own' }), { kind: 'mobile', deviceId: 'phone-1', transport }, expect.any(AbortSignal), expect.any(Function))
    await phone.rpc('mcpApps.request', { sessionId: 'own', request: { appInstanceId: 'view', operation: 'activate' } })
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const sending = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, request: { appInstanceId: 'view', operation: 'sendMessage', params: { role: 'user', content: [{ type: 'text', text: 'selected row' }] } } }
    const approval = await phone.rpc<McpAppHostResult>('mcpApps.request', sending)
    if (approval.ok || approval.error.code !== 'approval_required') throw new Error('Expected approval')
    const approved = { ...sending, request: { ...sending.request, approval: { challenge: approval.error.challenge } } }
    expect(await phone.rpc('mcpApps.request', approved, 'approved-send')).toMatchObject({ ok: true })
    expect(await phone.rpc('mcpApps.request', approved, 'approved-send')).toMatchObject({ ok: true })
    expect(own.sent).toHaveLength(1)
    expect(own.sent[0]).toMatchObject({ clientMessageId: 'app-send', priority: 'next' })
  })

  it('refuses missing or stolen control before invoking a View mutation', async () => {
    const { domain, request } = appDomain()
    const a = await connectPhone(domain, { deviceId: 'a' })
    const b = await connectPhone(domain, { deviceId: 'b' })
    cleanup.push(a.close, b.close)
    const lease = await a.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const input = { sessionId: 'own', request: { appInstanceId: 'view', operation: 'updateModelContext', context: { content: [{ type: 'text', text: 'selection' }] } } }
    await expect(a.rpc('mcpApps.request', input)).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(b.rpc('mcpApps.request', { ...input, leaseId: lease.leaseId, generation: lease.generation })).rejects.toMatchObject({ code: 'lease_stale' })
    expect(request).not.toHaveBeenCalled()
  })

  it('revalidates control after provider readiness before invoking its tool', async () => {
    const { domain, provider } = appDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    await phone.rpc('mcpApps.request', { sessionId: 'own', request: { appInstanceId: 'view', operation: 'activate' } })
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    let ready!: () => void
    provider.mockImplementationOnce(() => new Promise(resolve => { ready = () => resolve({ ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } }) }))
    provider.mockClear()
    const calling = phone.rpc('mcpApps.request', { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, request: { appInstanceId: 'view', operation: 'callTool', tool: 'next', args: {} } })
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'))
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    ready()
    expect(await calling).toMatchObject({ ok: false })
    expect(provider.mock.calls.map(call => call[1].operation)).toEqual(['ready'])
  })
})
