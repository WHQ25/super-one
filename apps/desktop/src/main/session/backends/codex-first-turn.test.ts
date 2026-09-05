import { describe, expect, it, vi } from 'vitest'
import type { AppServerConnectionHandle } from '../../codex/app-server-connection'
import { CodexBackend } from './codex-backend'
import { Session } from '../session'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-first-turn-test', getName: () => 'SuperOne', isPackaged: false }, ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), transports: { file: {}, console: {} } } }))
vi.mock('../../database', () => ({
  getActiveProviderRaw: () => null, getProviderByIdRaw: () => undefined,
  getDb: () => ({ prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }) }),
}))

/** Real Session -> CodexBackend -> Codex turn, stopping at the RPC boundary. */
function launchChild(options: { sandboxEnabled?: boolean; modelOnRequest?: boolean; explicitPreset?: 'read-only'; prewarm?: boolean } = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/start') return { thread: { id: 'child-thread' } }
    if (method === 'turn/start') throw new Error('captured turn/start')
    return {}
  })
  const handle = {
    connection: {
      request, respond: vi.fn(), notify: vi.fn(),
      nextNotification: () => new Promise(() => {}),
    },
    close: vi.fn(async () => {}), getStderr: () => '', onClosed: () => () => {},
  } as unknown as AppServerConnectionHandle
  const backend = new CodexBackend({
    getProjectAuth: () => ({ mode: 'auto' }),
    onAuthChanged: () => () => {},
    takeAppServerConnection: async () => handle,
  })
  const child = new Session({
    id: 'child', projectPath: '/tmp', cwd: '/tmp', providerId: 'codex-base', harnessId: 'codex',
    backend, providerConfig: { model: 'gpt-5.6-sol', permissionPreset: 'default' },
    model: 'gpt-5.6-luna', effort: 'max', codexServiceTier: 'priority',
    permissionMode: 'dontAsk', sandboxInfo: { enabled: options.sandboxEnabled ?? false, autoAllowBash: false },
  })
  if (options.prewarm) child.prewarm()
  const send = child.send({
    content: 'Approved child task', source: 'collaboration',
    ...(options.modelOnRequest !== false ? { model: 'gpt-5.6-luna' } : {}),
    ...(options.explicitPreset ? { codex: { permissionPreset: options.explicitPreset } } : {}),
  })
  return { request, send }
}

describe('Codex collaboration first turn', () => {
  it.each([
    { modelOnRequest: true, prewarm: false },
    { modelOnRequest: false, prewarm: false },
    { modelOnRequest: true, prewarm: true },
    { modelOnRequest: false, prewarm: true },
  ])('retains approved settings (request model=$modelOnRequest, prewarm=$prewarm)', async (options) => {
    const { request, send } = launchChild(options)
    await expect(send).rejects.toThrow('captured turn/start')
    expect(request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      model: 'gpt-5.6-luna', approvalPolicy: 'never', sandbox: 'danger-full-access',
    }))
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      model: 'gpt-5.6-luna', effort: 'max', serviceTier: 'priority', approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    }))
  })

  it('does not disable an enabled sandbox just because permission mode is dontAsk', async () => {
    const { request, send } = launchChild({ sandboxEnabled: true })
    await expect(send).rejects.toThrow('captured turn/start')
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      sandboxPolicy: expect.objectContaining({ type: 'workspaceWrite' }),
    }))
  })

  it('honors an explicit per-turn restricted preset', async () => {
    const { request, send } = launchChild({ explicitPreset: 'read-only' })
    await expect(send).rejects.toThrow('captured turn/start')
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      approvalPolicy: 'on-request', sandboxPolicy: expect.objectContaining({ type: 'readOnly' }),
    }))
  })
})
