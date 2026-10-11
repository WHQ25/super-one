import { describe, expect, it, vi } from 'vitest'
import type { AppServerConnectionHandle } from '../../codex/app-server-connection'
import { CodexBackend } from './codex-backend'
import { Session } from '../session'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-cold-permission-test', getName: () => 'SuperOne', isPackaged: false }, ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), transports: { file: {}, console: {} } } }))
vi.mock('../../database', () => ({
  getActiveProviderRaw: () => null, getProviderByIdRaw: () => undefined,
  getDb: () => ({ prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }) }),
}))

function setup() {
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/start') return { thread: { id: 'cold-thread' } }
    if (method === 'turn/start') throw new Error('captured turn/start')
    return {}
  })
  const handles: AppServerConnectionHandle[] = []
  const backend = new CodexBackend({
    getProjectAuth: () => ({ mode: 'auto' }), onAuthChanged: () => () => {},
    takeAppServerConnection: async () => {
      const handle = {
        connection: { request, respond: vi.fn(), notify: vi.fn(), nextNotification: () => new Promise(() => {}) },
        close: vi.fn(async () => {}), getStderr: () => '', onClosed: () => () => {},
      } as unknown as AppServerConnectionHandle
      handles.push(handle)
      return handle
    },
  })
  const session = new Session({
    id: 'cold-permission', projectPath: '/tmp', cwd: '/tmp', providerId: 'codex-base', harnessId: 'codex', backend,
    providerConfig: { model: 'gpt-6.1-sol' }, permissionMode: 'default',
  })
  return { backend, session, request, handles }
}

describe('Codex permission selection before the first send', () => {
  it.each([false, true])('applies the cold selection at the app-server boundary (prewarm=%s)', async (prewarm) => {
    const { session, request, handles } = setup()
    try {
      if (prewarm) {
        session.prewarm()
        await vi.waitFor(() => expect(request).toHaveBeenCalledWith('thread/start', expect.anything()))
      }
      await session.setPermissionMode('auto')
      if (prewarm) expect(handles[0].close).toHaveBeenCalledOnce()
      request.mockClear()
      await expect(session.send({ content: 'Test cold permission selection' })).rejects.toThrow('captured turn/start')
      expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ approvalsReviewer: 'auto_review' }))
      expect(session.getCurrentPermissionMode()).toBe('auto')
    } finally {
      await session.dispose()
    }
  })

  it('continues to reject settings on a disposed backend', async () => {
    const { backend, session } = setup()
    await session.dispose()
    await expect(backend.setPermissionMode('auto')).rejects.toThrow('CodexBackend already disposed')
  })
})
