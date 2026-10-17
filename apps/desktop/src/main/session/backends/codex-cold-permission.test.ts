import { describe, expect, it, vi } from 'vitest'
import type { AppServerConnectionHandle } from '../../codex/app-server-connection'
import { CodexBackend } from './codex-backend'
import { Session } from '../session'
import { applyDesktopSessionSettings } from '../../node-host/desktop-session-mutations'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-cold-permission-test', getName: () => 'SuperOne', isPackaged: false }, ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), transports: { file: {}, console: {} } } }))
vi.mock('../../database', () => ({
  getActiveProviderRaw: () => null, getProviderByIdRaw: () => undefined,
  getDb: () => ({ prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }) }),
}))

function setup(profilePreset?: 'full-access' | 'read-only') {
  const request = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
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
    providerConfig: { model: 'gpt-6.1-sol' }, permissionMode: profilePreset === 'full-access' ? 'bypassPermissions' : 'default',
    codexPermissionPreset: profilePreset,
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

describe('Codex Profile permission changes', () => {
  it.each(['cold', 'prewarmed', 'started'] as const)('applies a permission downgrade to the next turn when %s', async (state) => {
    const { session, request } = setup('full-access')
    try {
      if (state === 'prewarmed') {
        session.prewarm()
        await vi.waitFor(() => expect(request).toHaveBeenCalledWith('thread/start', expect.anything()))
      } else if (state === 'started') {
        await expect(session.send({ content: 'Initial Profile task' })).rejects.toThrow('captured turn/start')
      }
      await applyDesktopSessionSettings(session, { permissionMode: 'auto' })
      request.mockClear()
      await expect(session.send({ content: 'Continue with automatic review' })).rejects.toThrow('captured turn/start')
      const turn = request.mock.calls.find(([method]) => method === 'turn/start')?.[1]
      expect({ reviewer: turn?.approvalsReviewer, sandbox: turn?.sandboxPolicy }).toMatchObject({
        reviewer: 'auto_review', sandbox: { type: 'workspaceWrite' },
      })
      expect(session.getUiSettings().selectedCodexPermissionPreset).toBe('auto-review')
    } finally {
      await session.dispose()
    }
  })

  it('preserves native read-only permissions when the shared mode is unchanged', async () => {
    const { session, request } = setup('read-only')
    try {
      await applyDesktopSessionSettings(session, { permissionMode: 'default' })
      await expect(session.send({ content: 'Continue read-only' })).rejects.toThrow('captured turn/start')
      const turn = request.mock.calls.find(([method]) => method === 'turn/start')?.[1]
      expect(turn?.sandboxPolicy).toMatchObject({ type: 'readOnly' })
      expect(session.getUiSettings().selectedCodexPermissionPreset).toBe('read-only')
    } finally {
      await session.dispose()
    }
  })

  it('keeps both permission selections when the backend rejects a change', async () => {
    const { session, backend } = setup('full-access')
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((event) => events.push(event))
    events.length = 0
    vi.spyOn(backend, 'setPermissionMode').mockRejectedValueOnce(new Error('Permission update failed'))
    try {
      await expect(applyDesktopSessionSettings(session, { permissionMode: 'auto' })).rejects.toThrow('Permission update failed')
      expect(session.getUiSettings()).toMatchObject({ permissionMode: 'bypassPermissions', selectedCodexPermissionPreset: 'full-access' })
      expect(events.some((event) => event.type === 'permission_mode_change' || event.type === 'agent_setting_change')).toBe(false)
    } finally {
      await session.dispose()
    }
  })
})
