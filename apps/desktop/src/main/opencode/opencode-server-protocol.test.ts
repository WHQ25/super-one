import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawn: spawnMock,
}))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => undefined }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { startOpenCodeServer } from './opencode-client'

function fakeServe(banner: string) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
      return true
    }),
  })
  spawnMock.mockImplementationOnce(() => {
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${banner}\n`)))
    return child
  })
}

describe('OpenCode server protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    spawnMock.mockReset()
  })

  it.each([
    ['opencode server listening on http://127.0.0.1:4100', 'v1'],
    ['server listening on http://127.0.0.1:4100', 'v2'],
  ] as const)('reads a spawned server version from its ready line: %s', async (banner, protocol) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fakeServe(banner)
    const server = await startOpenCodeServer({ cwd: '/project' })
    expect(server).toMatchObject({ url: 'http://127.0.0.1:4100', protocol })
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it('detects an attached server from /api/info and reports a rejected password', async () => {
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(respond(200, { version: '2.0.22' }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(respond(401, { _tag: 'UnauthorizedError', message: 'Authentication required' })))

    await expect(startOpenCodeServer({ cwd: '/p', serverUrl: 'http://h/' })).resolves.toMatchObject({ url: 'http://h', protocol: 'v2' })
    await expect(startOpenCodeServer({ cwd: '/p', serverUrl: 'http://h' })).resolves.toMatchObject({ protocol: 'v1' })
    await expect(startOpenCodeServer({ cwd: '/p', serverUrl: 'http://h', serverPassword: 'wrong' }))
      .rejects.toThrow(/rejected the server password/)
  })
})
