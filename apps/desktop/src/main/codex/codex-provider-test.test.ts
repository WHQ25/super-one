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

const MODEL_LIST_OK = { data: [{ model: 'gpt-5-codex', isDefault: true }, { model: 'gpt-4o-mini' }] }

function turnReady(extra?: Record<string, unknown>): Record<string, unknown> {
  return { 'model/list': MODEL_LIST_OK, 'thread/start': { thread: { id: 't1' } }, 'turn/start': { turn: { id: 'turn1' } }, ...extra }
}

function reqCalls(handle: AppServerConnectionHandle): unknown[][] {
  return (handle.connection.request as unknown as ReturnType<typeof vi.fn>).mock.calls
}

function stageTypes(): string[] {
  return vi.mocked(trace).mock.calls.filter((c) => c[0] === 'codex.providertest').map((c) => c[1] as string)
}

describe('testCodexProvider', () => {
  beforeEach(() => {
    vi.mocked(trace).mockClear()
  })

  it('succeeds only after model/list then turn/completed, reporting the discovered model count', async () => {
    const { handle, closed } = makeHandle({
      requests: turnReady(),
      notifications: [
        { method: 'item/started', params: { item: { type: 'userMessage', content: [{ type: 'text', text: 'Reply with "ok" only.' }] } } },
        { method: 'item/started', params: { item: { type: 'agentMessage', text: 'ok' } } },
        { method: 'turn/completed', params: { turn: { status: 'completed' } } },
      ],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(true)
    expect(result.models).toBe(2)
    expect(closed()).toBe(true)
    expect(stageTypes()).toEqual(
      expect.arrayContaining(['start', 'env', 'connect', 'model_list', 'thread_start', 'turn_start', 'result']),
    )
  })

  it('fails at model/list and never runs a turn when the gateway lacks a /models endpoint', async () => {
    const { handle } = makeHandle({
      requests: { 'model/list': () => { throw new Error('404 page not found') } },
      notifications: [],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('model/list')
    expect(reqCalls(handle).some((c) => c[0] === 'thread/start')).toBe(false)
    const mlStage = vi.mocked(trace).mock.calls.find((c) => c[0] === 'codex.providertest' && c[1] === 'model_list')
    expect(mlStage?.[2]).toMatchObject({ ok: false })
  })

  it('fails when model/list returns an empty model set', async () => {
    const { handle } = makeHandle({
      requests: { 'model/list': { data: [] } },
      notifications: [],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('no models')
    expect(reqCalls(handle).some((c) => c[0] === 'thread/start')).toBe(false)
  })

  it('runs the turn with the default model from model/list, not a hardcoded gpt-5', async () => {
    const { handle } = makeHandle({
      requests: turnReady({ 'model/list': { data: [{ model: 'router-default', isDefault: true }, { model: 'other' }] } }),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })

    await testCodexProvider(input, async () => handle)

    const threadStart = reqCalls(handle).find((c) => c[0] === 'thread/start')
    const turnStart = reqCalls(handle).find((c) => c[0] === 'turn/start')
    expect(threadStart?.[1]).toMatchObject({ model: 'router-default' })
    expect(turnStart?.[1]).toMatchObject({ model: 'router-default' })
  })

  it('honors an explicit input.model over the model/list default', async () => {
    const { handle } = makeHandle({
      requests: turnReady({ 'model/list': { data: [{ model: 'router-default', isDefault: true }] } }),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })

    await testCodexProvider({ ...input, model: 'pinned-model' }, async () => handle)

    const threadStart = reqCalls(handle).find((c) => c[0] === 'thread/start')
    expect(threadStart?.[1]).toMatchObject({ model: 'pinned-model' })
  })

  it('does not falsely succeed on a userMessage item echo when the gateway then errors', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [
        { method: 'item/started', params: { item: { type: 'userMessage', content: [{ type: 'text', text: 'Reply with "ok" only.' }] } } },
        { method: 'error', params: { message: '401 Unauthorized', willRetry: false } },
      ],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('401')
  })

  it('fails immediately on a terminal HTTP 401 even when codex marks the error willRetry', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [
        {
          method: 'error',
          params: {
            error: {
              message: 'Reconnecting... 1/5',
              codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
              additionalDetails: 'unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}, url: https://gpt.zenaigc.com/v1/responses',
            },
            willRetry: true,
          },
        },
        { method: 'turn/completed', params: { turn: { status: 'completed' } } },
      ],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('401')
    expect(result.error).toContain('INVALID_API_KEY')
    expect(result.error).not.toContain('Reconnecting')
  })

  it('still retries past a non-terminal willRetry error and then succeeds', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [
        { method: 'error', params: { error: { message: 'Reconnecting... 1/5' }, willRetry: true } },
        { method: 'turn/completed', params: { turn: { status: 'completed' } } },
      ],
    })

    const result = await testCodexProvider(input, async () => handle)
    expect(result.success).toBe(true)
  })

  it('emits model_list then turn progress to the onProgress callback', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })
    const progress: string[] = []

    await testCodexProvider(input, async () => handle, (p) => progress.push(`${p.phase}:${p.status}`))

    expect(progress).toEqual(['model_list:start', 'model_list:ok', 'turn:start'])
  })

  it('treats turn/completed with completed status as success', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })

    const result = await testCodexProvider(input, async () => handle)
    expect(result.success).toBe(true)
  })

  it('classifies an error notification (auth failure) as a failed result with the provider message', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'error', params: { message: '401 Unauthorized', willRetry: false } }],
    })

    const result = await testCodexProvider(input, async () => handle)

    expect(result.success).toBe(false)
    expect(result.error).toContain('401')
  })

  it('classifies turn/completed failed as a failed result', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'connect ECONNREFUSED' } } } }],
    })

    const result = await testCodexProvider(input, async () => handle)
    expect(result.success).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('reports thread/start failure with a thread_start trace stage', async () => {
    const { handle } = makeHandle({
      requests: { 'model/list': MODEL_LIST_OK, 'thread/start': () => { throw new Error('bad model_providers schema') } },
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

  it('passes the provider override to the connection factory as CLI overrides (no ChatGPT account fallback)', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })
    const factory = vi.fn(async () => handle)

    await testCodexProvider(input, factory)

    const cliOverrides = factory.mock.calls[0]?.[2] as string[]
    expect(cliOverrides).toContain('model_provider=superone_custom')
    expect(cliOverrides.some((a) => a.startsWith('model_providers.superone_custom.base_url='))).toBe(true)
  })

  it('still passes model_provider + model_providers override into thread/start', async () => {
    const { handle } = makeHandle({
      requests: turnReady(),
      notifications: [{ method: 'turn/completed', params: { turn: { status: 'completed' } } }],
    })

    await testCodexProvider(input, async () => handle)

    const threadStartCall = reqCalls(handle).find((c) => c[0] === 'thread/start')
    expect(threadStartCall?.[1]).toMatchObject({
      model_provider: 'superone_custom',
      config: { model_providers: { superone_custom: expect.objectContaining({ base_url: 'https://gw.example.com/v1', wire_api: 'responses' }) } },
    })
  })
})
