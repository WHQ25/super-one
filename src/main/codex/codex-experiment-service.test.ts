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
