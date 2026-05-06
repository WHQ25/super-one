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

const { createAppServerConnection, resolvePermissionProfile } = await import('./app-server-connection')

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
})

describe('resolvePermissionProfile', () => {
  it('keeps Codex permission profiles aligned with app-server enforcement fields', () => {
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
