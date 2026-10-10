import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { requestMcpApp } from '../../../../mobile/src/mcp-apps'
import { createPhoneMethods, type PhoneMethodHost } from '../remote/phone-methods'
import { nativePhoneWire } from '../stream/native-phone-wire-fixture'
import { McpAppExecutor, type McpAppExecutorPorts } from './executor-core'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })
const app: ToolAppAttachment = { appInstanceId: 'v', binding: { node: 'local', session: 'own', server: 'cad', configGeneration: 0, configFingerprint: 'x' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad', status: 'result' }
const call = { messageId: 'm', appInstanceId: 'v', operation: 'callTool' as const, tool: 'read', args: {} }

describe('phone MCP App transient output', () => {
  it('roundtrips 2 MiB through the native endpoint and encrypted relay, rejecting oversized output and inputs', async () => {
    let text = randomBytes(1536 * 1024).toString('base64')
    let wire!: Awaited<ReturnType<typeof nativePhoneWire>>
    const persist = vi.fn()
    const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, operation) => operation.operation === 'ready'
      ? { ok: true as const, value: { mode: 'native', resourceRead: true, toolCall: true } }
      : operation.operation === 'tools' ? { ok: true as const, value: [{ name: 'read' }] }
      : { ok: true as const, value: { outcome: 'completed', result: { content: [{ type: 'text', text }] } } })
    const executor = new McpAppExecutor({ resolve: async () => ({ ref: { environmentId: wire.domain.identity.environmentId, sessionId: 'own' }, node: 'local', projectPath: wire.projectDir, messageId: 'm', app }), persist, provider, sendMessage: async () => {} })
    wire = await nativePhoneWire(cleanup, { phoneMethods: createPhoneMethods({ agent: {} as PhoneMethodHost['agent'],
      mcpAppsRequest: (request, requester, signal, validateTarget) => executor.execute(request, requester, signal, validateTarget) }) })
    const environmentId = wire.domain.identity.environmentId
    const ref = { environmentId, sessionId: 'own' }
    executor.observeLive(ref, app, { kind: 'mobile', deviceId: 'phone-1', transport: 'relay' })
    await wire.connection.control.acquire(ref)
    const client = { environmentId, rpc: wire.connection.rpc.bind(wire.connection), controlledRpc: wire.connection.control.call.bind(wire.connection.control) }
    const session = { projectPath: wire.projectDir, sessionId: 'own' }
    const mark = wire.mark()
    expect(await requestMcpApp(client, session, call)).toMatchObject({ ok: true, value: { result: { content: [{ text }] } } })
    expect(wire.measure(mark).frames).toBeGreaterThan(1)
    expect(persist).not.toHaveBeenCalled()
    text = 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES)
    await expect(requestMcpApp(client, session, call)).resolves.toMatchObject({ ok: false, error: { code: 'invalid', message: expect.stringContaining('size limit') } })
    const calls = provider.mock.calls.length
    await expect(requestMcpApp(client, session, { ...call, args: { text: 'x'.repeat(MCP_APP_DATA_MAX_BYTES) } })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(provider).toHaveBeenCalledTimes(calls)
  })
})
