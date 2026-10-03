import { describe, expect, it, vi } from 'vitest'
import type { McpAppsProvider } from '@superone/shared/mcp-apps'
import { withCodexMcpAppElicitation, dispatchCodexMcpAppElicitation, cancelCodexMcpAppInvocations, type CodexMcpAppElicitationHandler } from './mcp-app-elicitation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(connection: object = {}, server = 'fixture') {
  const replies: Array<ReturnType<typeof deferred<{ result: { content: never[] }; outcome: 'completed' }>>> = []
  const native: McpAppsProvider = {
    binding: { node: 'local', session: 'session', server, configGeneration: 0, configFingerprint: 'config' },
    ready: async () => ({ mode: 'native', resourceRead: true, toolCall: true, authenticate: false }),
    tools: async () => new Map(), readResource: async () => ({ contents: [] }), dispose: () => {},
    callTool: vi.fn(() => { const reply = deferred<{ result: { content: never[] }; outcome: 'completed' }>(); replies.push(reply); return reply.promise }),
  }
  const handle = vi.fn<CodexMcpAppElicitationHandler>(async () => ({ action: 'accept', content: null, _meta: null }))
  return { connection, native, replies, handle, provider: withCodexMcpAppElicitation(native, connection, 'root', handle) }
}
const request = { id: 0, params: { threadId: 'root', serverName: 'fixture', turnId: null } }
const result = { result: { content: [] as never[] }, outcome: 'completed' as const }

describe('native MCP App elicitation scope', () => {
  it('intercepts only standalone forms for the exact active thread/server/connection', async () => {
    const f = fixture()
    expect(dispatchCodexMcpAppElicitation(f.connection, request)).toBeUndefined()
    const running = f.provider.callTool({ tool: 'next', args: {} }, new AbortController().signal)
    await vi.waitFor(() => expect(f.native.callTool).toHaveBeenCalledOnce())
    for (const params of [{ ...request.params, threadId: 'other' }, { ...request.params, serverName: 'other' }, { ...request.params, turnId: 'model-turn' }]) {
      expect(dispatchCodexMcpAppElicitation(f.connection, { ...request, params })).toBeUndefined()
    }
    expect(dispatchCodexMcpAppElicitation({}, request)).toBeUndefined()
    await expect(dispatchCodexMcpAppElicitation(f.connection, request)).resolves.toMatchObject({ action: 'accept' })
    expect(f.handle).toHaveBeenCalledWith(request, expect.any(AbortSignal))
    f.replies[0]!.resolve(result)
    await running
    expect(dispatchCodexMcpAppElicitation(f.connection, request)).toBeUndefined()
  })

  it('keeps parallel calls to the same thread/server overlapping across Views', async () => {
    const f = fixture(), other = withCodexMcpAppElicitation(f.native, f.connection, 'root', f.handle)
    const one = f.provider.callTool({ tool: 'one', args: {} }, new AbortController().signal)
    const two = other.callTool({ tool: 'two', args: {} }, new AbortController().signal)
    expect(f.native.callTool).toHaveBeenCalledTimes(2)
    f.replies[1]!.resolve(result)
    await two
    expect(dispatchCodexMcpAppElicitation(f.connection, request)).toBeDefined()
    f.replies[0]!.resolve(result)
    await one
    expect(dispatchCodexMcpAppElicitation(f.connection, request)).toBeUndefined()
  })

  it('keeps a parallel scope form alive until the last call ends or cancels', async () => {
    const f = fixture(), abort = new AbortController()
    let formSignal!: AbortSignal
    f.handle.mockImplementation((_request, signal) => new Promise(resolve => {
      formSignal = signal
      signal.addEventListener('abort', () => resolve({ action: 'cancel', content: null, _meta: null }), { once: true })
    }))
    const one = f.provider.callTool({ tool: 'one', args: {} }, abort.signal)
    const two = f.provider.callTool({ tool: 'two', args: {} }, new AbortController().signal)
    const form = dispatchCodexMcpAppElicitation(f.connection, request)
    abort.abort()
    expect(formSignal.aborted).toBe(false)
    f.replies[0]!.resolve(result)
    await one
    expect(formSignal.aborted).toBe(false)
    f.replies[1]!.resolve(result)
    await two
    await expect(form).resolves.toMatchObject({ action: 'cancel' })
    expect(dispatchCodexMcpAppElicitation(f.connection, request)).toBeUndefined()
    expect(f.native.callTool).toHaveBeenCalledTimes(2)
  })

  it.each(['abort', 'close'] as const)('cancels a pending form on %s without retrying the native tool', async kind => {
    const f = fixture(), abort = new AbortController()
    f.handle.mockImplementation((_request, signal) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({ action: 'cancel', content: null, _meta: null }), { once: true })
    }))
    const running = f.provider.callTool({ tool: 'next', args: {} }, abort.signal)
    await vi.waitFor(() => expect(f.native.callTool).toHaveBeenCalledOnce())
    const form = dispatchCodexMcpAppElicitation(f.connection, request)
    if (kind === 'abort') abort.abort()
    else cancelCodexMcpAppInvocations(f.connection)
    await expect(form).resolves.toMatchObject({ action: 'cancel' })
    f.replies[0]!.resolve(result)
    await running
    expect(f.native.callTool).toHaveBeenCalledOnce()
  })
})
