import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpHttpConfig: () => null, getSuperoneMcpStdioConfig: () => null }))
import { OpenCodeBackend, setOpenCodeRuntimeFactory } from '../session/backends/opencode-backend'
import { createOpenCodeV2Runtime } from './opencode-v2-runtime'
import { OpenCodeV2Client } from './opencode-v2-client'
import { startOpenCodeEventProxy } from '../../test/fixtures/opencode-event-proxy'

const baseUrl = process.env.SUPERONE_OPENCODE_SMOKE_URL, directory = process.env.SUPERONE_OPENCODE_SMOKE_DIRECTORY
const password = process.env.SUPERONE_OPENCODE_SMOKE_PASSWORD

describe('OpenCode native recovery and inbox smoke', () => {
  it.skipIf(!baseUrl || !directory)('replays a shell completion across a dropped event source into the same host turn without rerunning it', async () => {
    const proxy = await startOpenCodeEventProxy(baseUrl!)
    const events: AgentEvent[] = [], backend = new OpenCodeBackend()
    let nativeId = ''
    setOpenCodeRuntimeFactory((opts) => createOpenCodeV2Runtime({ url: proxy.baseUrl, password, protocol: 'v2', exited: null, close: async () => {} }, opts))
    backend.onEvent((event) => events.push(event))
    backend.onProviderSessionId((id) => { nativeId = id })
    const direct = new OpenCodeV2Client({ baseUrl: baseUrl!, password, directory: directory! })
    try {
      await backend.start({ sessionId: 'recovery-smoke', projectPath: directory!, cwd: directory!, config: {}, permissionMode: 'default', abortController: new AbortController() })
      const turn = backend.send({ content: '!sleep 0.7; printf recovery-smoke', assistantMessageId: 'same-turn' })
      await vi.waitFor(() => expect(events.some((event) => event.type === 'content_delta' && event.delta.type === 'tool_use')).toBe(true))
      proxy.disconnect()
      await vi.waitFor(async () => expect((await direct.messages(nativeId, { type: 'shell', limit: 1 }))[0]).toMatchObject({ status: 'exited' }), { timeout: 5000 })
      expect(events.some((event) => event.type === 'message_complete')).toBe(false)
      proxy.allowReconnect()
      await vi.waitFor(() => expect(events.some((event) => event.type === 'message_complete' || event.type === 'harness_connection_changed' && event.connection.state === 'disconnected')).toBe(true), { timeout: 10000 })
      expect(events.some((event) => event.type === 'harness_connection_changed' && event.connection.state === 'disconnected')).toBe(false)
      await turn
      expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1)
      expect(events.filter((event) => event.type === 'message_complete')).toEqual([expect.objectContaining({ messageId: 'same-turn' })])
      expect(events).toContainEqual(expect.objectContaining({ type: 'content_delta', messageId: 'same-turn', isReplay: true,
        delta: expect.objectContaining({ type: 'tool_result', summary: 'recovery-smoke' }) }))
      expect(proxy.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/shell'))).toHaveLength(1)
      expect(events.some((event) => event.type === 'message_error')).toBe(false)
    } finally {
      await backend.close(); setOpenCodeRuntimeFactory(null)
      if (nativeId) await direct.deleteSession(nativeId)
      await proxy.close()
    }
  }, 30000)

  it.skipIf(!baseUrl || !directory)('lists and cancels native queued input and reads its exclusive log watermark without model execution', async () => {
    const client = new OpenCodeV2Client({ baseUrl: baseUrl!, password, directory: directory! })
    const session = await client.createSession([]), signal = new AbortController().signal
    try {
      const head = await client.sessionLog(session.id, Number.MAX_SAFE_INTEGER, signal)
      const id = await client.prompt(session.id, { text: 'offline inbox fixture', delivery: 'steer', resume: false })
      expect(await client.inbox(session.id)).toContainEqual(expect.objectContaining({ id, delivery: 'steer' }))
      await client.updateInbox(session.id, id, 'queue')
      expect(await client.inbox(session.id)).toContainEqual(expect.objectContaining({ id, delivery: 'queue' }))
      await client.cancelInbox(session.id, id)
      expect(await client.inbox(session.id)).toEqual([])
      const log = await client.sessionLog(session.id, head.cursor, signal)
      expect(log.cursor).toBeGreaterThan(head.cursor)
      // Native 2.0.24 may return only the advancing watermark. Recovery tests
      // exercise the authoritative projection fallback for that log gap.
      if (log.events.length) expect(log.events.map((event) => event.type)).toEqual(expect.arrayContaining(['session.inbox.enqueued', 'session.inbox.cancelled']))
      expect((await client.sessionLog(session.id, log.cursor, signal)).events).toEqual([])
      expect(await client.messages(session.id, { type: 'user' })).toEqual([])
    } finally { await client.deleteSession(session.id) }
  }, 15000)
})
