import { EventEmitter, PassThrough } from 'stream'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: {
      file: {
        getFile: () => ({ path: '/tmp/codex.log' }),
      },
    },
  },
}))

vi.mock('../agent/event-trace', () => ({
  trace: vi.fn(),
}))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
  getProviderByIdRaw: vi.fn(() => undefined),
}))

vi.mock('../providers/resolver', () => ({
  resolveChatService: vi.fn(() => null),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node' })),
}))

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  pid: number
}

function createFakeChild(): FakeChild {
  const emitter = new EventEmitter() as FakeChild
  emitter.stdin = new PassThrough()
  emitter.stdout = new PassThrough()
  emitter.stderr = new PassThrough()
  emitter.kill = vi.fn(() => {
    emitter.killed = true
    emitter.stdout.end()
    emitter.stderr.end()
    emitter.emit('exit', null, 'SIGTERM')
    return true
  })
  emitter.killed = false
  emitter.pid = 99999
  return emitter
}

const spawnMock = vi.fn<() => FakeChild>()
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => { throw new Error('no system codex in test') }),
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
}))

// Pretend the bundled platform package is present so we take the node-runtime branch.
vi.mock('module', async () => {
  const actual = await vi.importActual<typeof import('module')>('module')
  return {
    ...actual,
    createRequire: () => {
      const req = Object.assign(
        (id: string) => actual.createRequire(import.meta.url)(id),
        {
          resolve: (id: string) => {
            if (id.endsWith('/package.json')) return '/mock/pkg.json'
            if (id === '@openai/codex/bin/codex.js') return '/mock/codex.js'
            return actual.createRequire(import.meta.url).resolve(id)
          },
          cache: {},
          extensions: {},
          main: undefined,
        },
      )
      return req as unknown as NodeJS.Require
    },
  }
})

const {
  createAppServerConnection,
  resolvePermissionProfile,
  buildAppServerEnv,
  getCodexProviderOverride,
  getCodexProviderOverrideFor,
  buildCodexProviderCliOverrides,
  buildCodexProviderCliOverridesFor,
  buildNodeReplDisableCliOverrides,
  isCodexAppServerConnectionError,
} = await import('./app-server-connection')
const { resolveChatService } = await import('../providers/resolver')

function resolvedService(over: Partial<Record<string, unknown>> = {}) {
  return {
    platformId: 'gw',
    brand: 'My Gateway',
    planId: 'api',
    endpointId: 'openai',
    credentialId: 'c1',
    task: 'chat',
    protocol: 'openai-chat',
    baseUrl: '',
    apiKey: '',
    auth: 'api-key',
    models: [],
    ...over,
  } as never
}

function writeLineToChild(child: FakeChild, payload: Record<string, unknown>): void {
  child.stdout.write(`${JSON.stringify(payload)}\n`)
}

function collectStdinLines(child: FakeChild): string[] {
  const chunks: string[] = []
  child.stdin.on('data', (data: Buffer) => {
    chunks.push(data.toString('utf8'))
  })
  return chunks
}

async function nextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('createAppServerConnection', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('completes initialize handshake and returns a usable connection', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)
    const stdinLines = collectStdinLines(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey', apiKey: 'k' })
    await nextTick()

    // Respond to the initialize request (expect id=1)
    writeLineToChild(child, { id: 1, result: { serverInfo: { name: 'codex' } } })

    const handle = await handlePromise
    expect(handle.connection).toBeDefined()

    // The first stdin payload should be the initialize request
    const firstPayload = stdinLines.join('').split('\n').filter(Boolean)[0]
    const parsed = JSON.parse(firstPayload)
    expect(parsed.method).toBe('initialize')
    expect(parsed.id).toBe(1)

    // The next payload should be the initialized notification (no id)
    const secondPayload = stdinLines.join('').split('\n').filter(Boolean)[1]
    const initNote = JSON.parse(secondPayload)
    expect(initNote.method).toBe('initialized')
    expect(initNote.id).toBeUndefined()

    await handle.close()
    expect(child.kill).toHaveBeenCalled()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      createAppServerConnection({ mode: 'apiKey' }, controller.signal),
    ).rejects.toThrow(/interrupted/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('spawns the bundled native binary directly (no Node bridge) and prepends codex-path to PATH', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    const exe = spawnMock.mock.calls[0][0] as string
    const opts = spawnMock.mock.calls[0][2] as { env: NodeJS.ProcessEnv }
    expect(exe).toMatch(/\/vendor\/[a-z0-9_-]+(?:-[a-z0-9_-]+)+\/bin\/codex(?:\.exe)?$/)
    expect(exe).not.toMatch(/\.js$/)
    expect(opts.env.PATH ?? '').toContain('/vendor/')
    expect(opts.env.PATH ?? '').toContain('/codex-path')

    await handle.close()
  })

  it('injects cli overrides as -c args before the app-server subcommand', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection(
      { mode: 'apiKey', apiKey: 'k' },
      undefined,
      undefined,
      ['-c', 'model_provider=superone_custom', '-c', 'model_providers.superone_custom.base_url="https://gw/v1"'],
    )
    await nextTick()
    writeLineToChild(child, { id: 1, result: { serverInfo: { name: 'codex' } } })
    const handle = await handlePromise

    const args = spawnMock.mock.calls[0][1] as string[]
    const cIdx = args.indexOf('-c')
    const appServerIdx = args.indexOf('app-server')
    expect(cIdx).toBeGreaterThanOrEqual(0)
    expect(cIdx).toBeLessThan(appServerIdx)
    expect(args).toContain('model_provider=superone_custom')
    expect(args).toContain('model_providers.superone_custom.base_url="https://gw/v1"')

    await handle.close()
  })
})

describe('buildCodexProviderCliOverrides', () => {
  it('returns [] for GPT subscription (null override) so node_repl stays available', () => {
    const args = buildCodexProviderCliOverrides(null)
    expect(args).toEqual([])
    expect(args.join(' ')).not.toContain('mcp_servers.node_repl')
  })

  it('disables node_repl with a stub stdio command so Codex accepts the table', () => {
    const pairs: string[] = []
    const args = buildNodeReplDisableCliOverrides()
    for (let i = 0; i < args.length; i += 2) {
      expect(args[i]).toBe('-c')
      pairs.push(args[i + 1])
    }
    expect(pairs).toEqual([
      'mcp_servers.node_repl.command="superone-disabled-node-repl"',
      'mcp_servers.node_repl.enabled=false',
    ])
  })

  it('flattens the provider override into -c key=value pairs with TOML-quoted strings', () => {
    const ov = {
      id: 'superone_custom',
      info: {
        name: 'My GW',
        base_url: 'https://gw.example.com/v1',
        env_key: 'CODEX_API_KEY',
        wire_api: 'responses',
        requires_openai_auth: false,
      },
    }

    const args = buildCodexProviderCliOverrides(ov)

    // grouped as -c <pair> repeated
    const pairs: string[] = []
    for (let i = 0; i < args.length; i += 2) {
      expect(args[i]).toBe('-c')
      pairs.push(args[i + 1])
    }
    expect(pairs).toContain('model_provider=superone_custom')
    expect(pairs).toContain('features.remote_plugin=false')
    expect(pairs).toContain('features.apps=false')
    // Dummy command + enabled=false so Codex accepts the table (no invalid transport)
    // when the user has no prior [mcp_servers.node_repl] block.
    expect(pairs).toContain('mcp_servers.node_repl.command="superone-disabled-node-repl"')
    expect(pairs).toContain('mcp_servers.node_repl.enabled=false')
    expect(pairs).toContain('model_providers.superone_custom.base_url="https://gw.example.com/v1"')
    expect(pairs).toContain('model_providers.superone_custom.env_key="CODEX_API_KEY"')
    expect(pairs).toContain('model_providers.superone_custom.wire_api="responses"')
    expect(pairs).toContain('model_providers.superone_custom.requires_openai_auth=false')
    expect(pairs).toContain('model_providers.superone_custom.name="My GW"')
  })

  it('enables reasoning summaries for a mapped Chat provider', () => {
    const args = buildCodexProviderCliOverrides({
      id: 'superone_custom',
      info: { name: 'My GW' },
    }, true)

    expect(args).toContain('model_supports_reasoning_summaries=true')
  })

  it('derives the reasoning override from the resolved provider', () => {
    vi.mocked(resolveChatService).mockReturnValue(resolvedService({
      platformId: 'custom:gateway',
      baseUrl: 'https://gw.example.com/v1',
    }))

    expect(buildCodexProviderCliOverridesFor()).toContain('model_supports_reasoning_summaries=true')
    vi.mocked(resolveChatService).mockReturnValue(null)
  })

  it('close is idempotent', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    await handle.close()
    await handle.close()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('captures stderr and exposes it via getStderr()', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()

    child.stderr.write('warning: something happened\n')
    await nextTick()

    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    expect(handle.getStderr()).toContain('warning: something happened')
    await handle.close()
  })

  it('onClosed fires when child exits', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    const closedCb = vi.fn()
    handle.onClosed(closedCb)

    child.emit('exit', 0, null)
    expect(closedCb).toHaveBeenCalledWith(expect.objectContaining({ code: 0 }))
  })

  it('captures stdin EPIPE and rejects later requests without an uncaught stream error', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise
    const writeError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })

    child.stdin.emit('error', writeError)

    await expect(handle.connection.request('thread/read')).rejects.toBe(writeError)
    expect(isCodexAppServerConnectionError(writeError)).toBe(true)
    await handle.close()
  })

  it('supports multiple sequential requests on one connection', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)
    const stdinLines = collectStdinLines(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    const requestA = handle.connection.request('thread/start')
    await nextTick()
    writeLineToChild(child, { id: 2, result: { thread: { id: 't1' } } })
    expect(await requestA).toEqual({ thread: { id: 't1' } })

    const requestB = handle.connection.request('turn/start', { thread_id: 't1' })
    await nextTick()
    writeLineToChild(child, { id: 3, result: { turn: { id: 'tu1' } } })
    expect(await requestB).toEqual({ turn: { id: 'tu1' } })

    const ids = stdinLines
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).id)
      .filter((id): id is number => typeof id === 'number')
    expect(ids).toEqual([1, 2, 3])

    await handle.close()
  })

  it('dispatches a request response even while a notification consumer is waiting', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    // Notification consumer is parked first, mirroring streamTurnEvents awaiting nextNotification().
    const notificationPromise = handle.connection.nextNotification()

    // Now fire a concurrent request (mirrors turn/steer from the UI mid-turn).
    const steerPromise = handle.connection.request('turn/steer', { text: 'stop' })
    await nextTick()

    // The server answers the request before any notification arrives.
    writeLineToChild(child, { id: 2, result: { ok: true } })
    await expect(steerPromise).resolves.toEqual({ ok: true })

    // Then a notification comes in — the parked consumer should receive it.
    writeLineToChild(child, { method: 'turn/completed', params: { turn: { status: 'completed' } } })
    await expect(notificationPromise).resolves.toMatchObject({
      method: 'turn/completed',
    })

    await handle.close()
  })

  it('retries idempotent reads on JSON-RPC -32001 backpressure and resolves with the eventual success', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    const listPromise = handle.connection.request('permissionProfile/list')
    await nextTick()
    writeLineToChild(child, { id: 2, error: { code: -32001, message: 'Server overloaded; retry later.' } })

    await nextTick()
    await new Promise((r) => setTimeout(r, 250))

    writeLineToChild(child, { id: 3, result: { data: [{ id: ':workspace', description: null }] } })
    await expect(listPromise).resolves.toEqual({ data: [{ id: ':workspace', description: null }] })

    await handle.close()
  })

  it('does not retry non-idempotent methods on -32001 and surfaces the error immediately', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValueOnce(child)

    const handlePromise = createAppServerConnection({ mode: 'apiKey' })
    await nextTick()
    writeLineToChild(child, { id: 1, result: {} })
    const handle = await handlePromise

    const turnPromise = handle.connection.request('turn/start', { threadId: 't1', input: [] })
    await nextTick()
    writeLineToChild(child, { id: 2, error: { code: -32001, message: 'Server overloaded; retry later.' } })

    await expect(turnPromise).rejects.toThrow(/Server overloaded/)

    await handle.close()
  })
})

describe('resolvePermissionProfile', () => {
  it('keeps Codex permission profiles aligned with app-server enforcement fields', () => {
    expect(resolvePermissionProfile('read-only')).toEqual({
      permissionPreset: 'read-only',
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only',
      networkAccessEnabled: false,
    })
    expect(resolvePermissionProfile('default')).toEqual({
      permissionPreset: 'default',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      networkAccessEnabled: false,
    })
    expect(resolvePermissionProfile('full-access')).toEqual({
      permissionPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      networkAccessEnabled: true,
    })
  })
})

describe('buildAppServerEnv custom Codex provider', () => {
  beforeEach(() => {
    vi.mocked(resolveChatService).mockReturnValue(null)
  })

  it('injects CODEX_API_KEY and extra_env but never the unsupported OPENAI_BASE_URL', () => {
    vi.mocked(resolveChatService).mockReturnValue(
      resolvedService({ baseUrl: 'https://gw.example.com/v1', apiKey: 'sk-test', extraEnv: { FOO: 'bar' } }),
    )

    const env = buildAppServerEnv({ mode: 'apiKey' } as never)

    expect(env.CODEX_API_KEY).toBe('sk-test')
    expect(env.FOO).toBe('bar')
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })
})

describe('getCodexProviderOverride', () => {
  beforeEach(() => {
    vi.mocked(resolveChatService).mockReturnValue(null)
  })

  it('returns null when no codex service resolves', () => {
    expect(getCodexProviderOverride()).toBeNull()
  })

  it('returns null when the resolved service has no base_url', () => {
    vi.mocked(resolveChatService).mockReturnValue(resolvedService({ baseUrl: '' }))
    expect(getCodexProviderOverride()).toBeNull()
  })

  it('builds a Responses-API provider definition keyed by superone_custom', () => {
    vi.mocked(resolveChatService).mockReturnValue(
      resolvedService({ baseUrl: 'https://gw.example.com/v1', brand: 'My Gateway' }),
    )

    expect(getCodexProviderOverride()).toEqual({
      id: 'superone_custom',
      info: {
        name: 'My Gateway',
        base_url: 'https://gw.example.com/v1',
        env_key: 'CODEX_API_KEY',
        wire_api: 'responses',
        requires_openai_auth: false,
      },
    })
  })
})

describe('getCodexProviderOverrideFor (session-scoped)', () => {
  it('builds the override from the resolved codex service for the given credential id', () => {
    vi.mocked(resolveChatService).mockReturnValue(resolvedService({ baseUrl: 'https://session/v1' }))

    const ov = getCodexProviderOverrideFor('sess-1')
    expect(resolveChatService).toHaveBeenCalledWith('codex', 'sess-1')
    expect(ov?.info.base_url).toBe('https://session/v1')
  })

  it('returns null when the resolved service has no base_url', () => {
    vi.mocked(resolveChatService).mockReturnValue(resolvedService({ baseUrl: '' }))
    expect(getCodexProviderOverrideFor('missing')).toBeNull()
  })
})
