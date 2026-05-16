import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../agent/event-trace', () => ({
  trace: vi.fn(),
}))

vi.mock('../agent/probe-cwd', () => ({
  resolveProbeCwd: vi.fn(() => '/tmp/probe'),
}))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node' })),
}))

const { trace } = await import('../agent/event-trace')
const { testCodexProvider } = await import('./codex-provider-test')
import type { AppServerConnectionHandle, AppServerNotification } from './app-server-connection'

interface ScriptedConn {
  requests: Record<string, unknown | (() => never)>
  notifications: AppServerNotification[]
}

function makeHandle(script: ScriptedConn): { handle: AppServerConnectionHandle; closed: () => boolean } {
  let isClosed = false
  let idx = 0
  const connection = {
    request: vi.fn(async (method: string) => {
      const r = script.requests[method]
      if (typeof r === 'function') return (r as () => never)()
      return (r ?? {}) as Record<string, unknown>
    }),
    respond: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    nextNotification: vi.fn(async () => {
      if (idx < script.notifications.length) return script.notifications[idx++]
      await new Promise((r) => setTimeout(r, 10_000))
      throw new Error('Codex app-server closed unexpectedly')
    }),
  }
  const handle = {
    connection,
    close: vi.fn(async () => { isClosed = true }),
    getStderr: () => '',
    onClosed: () => () => {},
  } as unknown as AppServerConnectionHandle
  return { handle, closed: () => isClosed }
}

const input = { api_key: 'sk-test', base_url: 'https://gw.example.com/v1', extra_env: '{}', name: 'GW' }

function stageTypes(): string[] {
  return vi.mocked(trace).mock.calls.filter((c) => c[0] === 'codex.providertest').map((c) => c[1] as string)
}

describe('testCodexProvider', () => {
  beforeEach(() => {
    vi.mocked(trace).mockClear()
  })

  it('returns success and closes the connection when the turn produces an item', async () => {
    const { handle, closed } = makeHandle({
      requests: { 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } } },
      notifications: [{ method: 'item/started', params: {} }],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(true)
    expect(closed()).toBe(true)
    expect(stageTypes()).toEqual(
      expect.arrayContaining(['start', 'env', 'connect', 'thread_start', 'turn_start', 'result']),
    )
  })

  it('treats turn/completed with completed status as success', async () => {
    const { handle } = makeHandle({
      requests: { 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } } },
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })

    const result = await testCodexProvider(input, async () => handle)
    expect(result.success).toBe(true)
  })

  it('classifies an error notification (auth failure) as a failed result with the provider message', async () => {
    const { handle } = makeHandle({
      requests: { 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } } },
      notifications: [{ method: 'error', params: { message: '401 Unauthorized', willRetry: false } }],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('401')
  })

  it('classifies turn/completed failed as a failed result', async () => {
    const { handle } = makeHandle({
      requests: { 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } } },
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'connect ECONNREFUSED' } } } }],
    })

    const result = await testCodexProvider(input, async () => handle)
    expect(result.success).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('reports thread/start failure with a thread_start trace stage', async () => {
    const { handle } = makeHandle({
      requests: { 'thread/start': () => { throw new Error('bad model_providers schema') } },
      notifications: [],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('thread/start')
    const tsStage = vi.mocked(trace).mock.calls.find((c) => c[0] === 'codex.providertest' && c[1] === 'thread_start')
    expect(tsStage?.[2]).toMatchObject({ ok: false })
  })

  it('reports app-server launch failure when the connection factory throws', async () => {
    const result = await testCodexProvider(input, async () => { throw new Error('codex binary missing') })

    expect(result.success).toBe(false)
    expect(result.error).toContain('launch failed')
    const connectStage = vi.mocked(trace).mock.calls.find((c) => c[0] === 'codex.providertest' && c[1] === 'connect')
    expect(connectStage?.[2]).toMatchObject({ ok: false })
  })

  it('fails fast when base_url is empty without spawning a connection', async () => {
    const factory = vi.fn()
    const result = await testCodexProvider({ ...input, base_url: '  ' }, factory as never)

    expect(result.success).toBe(false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('passes model_provider + model_providers override into thread/start', async () => {
    const { handle } = makeHandle({
      requests: { 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } } },
      notifications: [{ method: 'item/started', params: {} }],
    })

    await testCodexProvider(input, async () => handle)

    const reqMock = (handle.connection.request as unknown as ReturnType<typeof vi.fn>)
    const threadStartCall = reqMock.mock.calls.find((c) => c[0] === 'thread/start')
    expect(threadStartCall?.[1]).toMatchObject({
      model_provider: 'superone_custom',
      config: { model_providers: { superone_custom: expect.objectContaining({ base_url: 'https://gw.example.com/v1', wire_api: 'responses' }) } },
    })
  })
})
