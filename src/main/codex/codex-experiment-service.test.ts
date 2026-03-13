import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { CodexExperimentService } = await import('./codex-experiment-service')

function createSession(projectPath: string, runningController: AbortController | { abort: () => void } | null) {
  return {
    projectPath,
    permissionPreset: 'default' as const,
    threadId: null,
    effectiveCwd: null,
    runningController,
    pendingApprovals: new Map(),
    activeTurnId: null,
    steerFn: null,
  }
}

describe('resolveThread fallback', () => {
  const permissionProfile = {
    permissionPreset: 'default' as const,
    approvalPolicy: 'unless-allow-listed' as const,
    sandboxMode: 'permissive' as const,
    networkAccessEnabled: true,
  }

  it('falls back to thread/start when thread/resume fails', async () => {
    const service = new CodexExperimentService()
    const session = { ...createSession('/project', null), model: 'gpt-5', threadId: 'stale-thread' }
    const mockConnection = {
      request: vi.fn()
        .mockRejectedValueOnce(new Error('thread not found'))
        .mockResolvedValueOnce({ thread: { id: 'new-thread-1' } }),
    }

    const result = await (service as any).resolveThread(mockConnection, session, '/project', permissionProfile)

    expect(result).toBe('new-thread-1')
    expect(session.threadId).toBe('new-thread-1')
    expect(mockConnection.request).toHaveBeenCalledTimes(2)
    expect(mockConnection.request.mock.calls[0][0]).toBe('thread/resume')
    expect(mockConnection.request.mock.calls[1][0]).toBe('thread/start')
  })

  it('uses thread/resume when it succeeds', async () => {
    const service = new CodexExperimentService()
    const session = { ...createSession('/project', null), model: 'gpt-5', threadId: 'valid-thread' }
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'valid-thread' } }),
    }

    const result = await (service as any).resolveThread(mockConnection, session, '/project', permissionProfile)

    expect(result).toBe('valid-thread')
    expect(mockConnection.request).toHaveBeenCalledTimes(1)
    expect(mockConnection.request.mock.calls[0][0]).toBe('thread/resume')
  })

  it('uses thread/start when no threadId exists', async () => {
    const service = new CodexExperimentService()
    const session = { ...createSession('/project', null), model: 'gpt-5' }
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    }

    const result = await (service as any).resolveThread(mockConnection, session, '/project', permissionProfile)

    expect(result).toBe('fresh-thread')
    expect(mockConnection.request).toHaveBeenCalledTimes(1)
    expect(mockConnection.request.mock.calls[0][0]).toBe('thread/start')
  })
})

describe('CodexExperimentService auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports running when any session in the project is active', () => {
    const service = new CodexExperimentService()

    ;(service as any).sessions.set('sid-a', createSession('/project', {} as AbortController))
    ;(service as any).sessions.set('sid-b', createSession('/other', null))

    expect(service.getAuthStatus('/project').isRunning).toBe(true)
    expect(service.getAuthStatus('/other').isRunning).toBe(false)
  })

  it('aborts project sessions and clears running state when auth changes', () => {
    const service = new CodexExperimentService()
    const abortProject = vi.fn()
    const abortOther = vi.fn()
    const rejectPending = vi.fn()

    const projectSession = createSession('/project', { abort: abortProject })
    projectSession.pendingApprovals.set('req-1', {
      responseKind: 'decision',
      resolve: vi.fn(),
      reject: rejectPending,
    })

    ;(service as any).sessions.set('sid-project', projectSession)
    ;(service as any).sessions.set('sid-other', createSession('/other', { abort: abortOther }))

    const status = service.setAuth('/project', { mode: 'chatgpt' })

    expect(abortProject).toHaveBeenCalledTimes(1)
    expect(rejectPending).toHaveBeenCalledTimes(1)
    expect(abortOther).not.toHaveBeenCalled()
    expect((service as any).sessions.get('sid-project').runningController).toBeNull()
    expect(status.mode).toBe('chatgpt')
    expect(status.isRunning).toBe(false)
  })
})
