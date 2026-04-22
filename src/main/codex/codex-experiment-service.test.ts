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

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

const { CodexExperimentService } = await import('./codex-experiment-service')

describe('CodexExperimentService auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('setAuth emits onAuthChanged event for listeners on the same project', () => {
    const service = new CodexExperimentService()
    const listener = vi.fn()
    const otherListener = vi.fn()
    service.onAuthChanged('/project', listener)
    service.onAuthChanged('/other', otherListener)

    service.setAuth('/project', { mode: 'chatgpt' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(otherListener).not.toHaveBeenCalled()
  })

  it('getAuthStatus reports configured mode and resolved state (isRunning is always false at service level)', () => {
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })
    const status = service.getAuthStatus('/project')
    expect(status.mode).toBe('chatgpt')
    expect(status.isRunning).toBe(false)
  })

  it('getProjectAuth returns a default auto auth for unknown projects', () => {
    const service = new CodexExperimentService()
    expect(service.getProjectAuth('/unknown').mode).toBe('auto')
  })

  it('closeProject clears listeners and emits one final auth-changed event', () => {
    const service = new CodexExperimentService()
    const listener = vi.fn()
    service.onAuthChanged('/project', listener)
    service.setAuth('/project', { mode: 'chatgpt' })
    expect(listener).toHaveBeenCalledTimes(1)

    service.closeProject('/project')
    expect(listener).toHaveBeenCalledTimes(2)

    service.setAuth('/project', { mode: 'chatgpt' })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
