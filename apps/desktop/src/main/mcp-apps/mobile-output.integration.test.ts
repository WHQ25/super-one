import { randomBytes, webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { RpcInbox } from '@superone/relay-client'
import { decryptHostPayload } from '@superone/relay-client/crypto'
import { MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { REMOTE_RESPONSE_CHUNK_CHARS } from '@superone/shared/remote-payload'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { requestMcpApp } from '../../../../mobile/src/mcp-apps'
import { encryptHostPayload } from '../remote/payload-codec'
import { McpAppExecutor, type McpAppExecutorPorts } from './executor-core'
import { deviceMcpAppHostRequest } from './mobile-request'

const app: ToolAppAttachment = { appInstanceId: 'v', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'x' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad', status: 'result' }
const requester = { kind: 'mobile' as const, deviceId: 'phone', transport: 'relay' as const }
const session = { projectPath: '/project', sessionId: 's' }
const call = { messageId: 'm', appInstanceId: 'v', operation: 'callTool' as const, tool: 'read', args: {} }

describe('phone MCP App transient output', () => {
  it('roundtrips a 2 MiB mcp_app_request through existing encryption and chunks, then returns invalid for oversized output', async () => {
    let text = randomBytes(1536 * 1024).toString('base64')
    const persist = vi.fn()
    const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, operation) => operation.operation === 'ready' ? { ok: true as const, value: { mode: 'native', resourceRead: true, toolCall: true } }
      : operation.operation === 'tools' ? { ok: true as const, value: [{ name: 'read' }] }
      : { ok: true as const, value: { outcome: 'completed', result: { content: [{ type: 'text', text }] } } })
    const executor = new McpAppExecutor({ resolve: async () => ({ ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', messageId: 'm', app }), persist, provider, sendMessage: async () => {} })
    executor.observeLive({ environmentId: 'local', sessionId: 's' }, app, requester)
    const keyBytes = new Uint8Array(32).fill(4)
    const aesKey = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
    const inbox = new RpcInbox()
    let chunks = 0
    const client = { request: (command: RemoteCommand, timeout?: number) => inbox.begin(command, () => {
      void (async () => {
        if (command.type !== 'mcp_app_request') throw new Error('Unexpected command')
        const response = await executor.execute(deviceMcpAppHostRequest(command.projectPath, command.sessionId, command.request), requester, new AbortController().signal)
        const encrypted = await encryptHostPayload(aesKey, { response })
        const total = Math.ceil(encrypted.length / REMOTE_RESPONSE_CHUNK_CHARS)
        chunks = total
        for (let i = 0; i < total; i++) {
          const complete = inbox.ingestChunk(command.requestId, i, total, encrypted.slice(i * REMOTE_RESPONSE_CHUNK_CHARS, (i + 1) * REMOTE_RESPONSE_CHUNK_CHARS))
          if (complete) inbox.complete(command.requestId, decryptHostPayload(keyBytes, complete))
        }
      })().catch(error => inbox.fail('requestId' in command ? command.requestId! : '', error))
    }, keyBytes, timeout) }
    expect(await requestMcpApp(client, session, call)).toMatchObject({ ok: true, value: { result: { content: [{ text }] } } })
    expect(chunks).toBeGreaterThan(1)
    expect(persist).not.toHaveBeenCalled()
    text = 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES)
    await expect(requestMcpApp(client, session, call)).resolves.toMatchObject({ ok: false, error: { code: 'invalid', message: expect.stringContaining('size limit') } })
    const calls = provider.mock.calls.length
    await expect(requestMcpApp(client, session, { ...call, args: { text: 'x'.repeat(MCP_APP_DATA_MAX_BYTES) } })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(provider).toHaveBeenCalledTimes(calls)
  })
})
