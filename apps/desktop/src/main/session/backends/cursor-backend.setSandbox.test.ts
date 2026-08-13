import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendStartOptions } from '../types'

const { factoryMock, prewarmMock } = vi.hoisted(() => ({
  factoryMock: vi.fn(),
  prewarmMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../cursor/cursor-runtime', () => ({
  getCursorRuntimeFactory: () => factoryMock,
  setCursorRuntimeFactory: vi.fn(),
  prewarmCursorWorkspace: (...args: unknown[]) => prewarmMock(...args),
}))

vi.mock('../../cursor/cursor-auth', () => ({
  mapPermissionToCursorLocal: (mode: string) => {
    if (mode === 'plan') return { mode: 'plan', autoReview: false }
    if (mode === 'auto' || mode === 'default' || mode === 'acceptEdits') {
      return { mode: 'agent', autoReview: true }
    }
    return { mode: 'agent', autoReview: false }
  },
}))

vi.mock('../../database', () => ({
  getCachedHarnessResources: () => null,
}))

vi.mock('@superone/cursor', () => ({
  buildCursorModelSelection: () => undefined,
  parseCursorContextWindow: () => null,
}))

import { CursorBackend } from './cursor-backend'

function makeOpts(overrides: Partial<BackendStartOptions> = {}): BackendStartOptions {
  return {
    sessionId: 's1',
    projectPath: '/tmp/p',
    cwd: '/tmp/p',
    config: {},
    permissionMode: 'auto',
    sandboxInfo: { enabled: false, autoAllowBash: false },
    abortController: new AbortController(),
    ...overrides,
  }
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'a1',
    isCloud: false,
    lastRunId: null,
    send: vi.fn().mockResolvedValue({}),
    cancel: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
    reload: vi.fn(),
    getMcpServerStatus: vi.fn().mockResolvedValue([]),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
    ...overrides,
  }
}

describe('CursorBackend setSandbox / setPermissionMode', () => {
  beforeEach(() => {
    factoryMock.mockReset()
    prewarmMock.mockReset().mockResolvedValue(undefined)
  })

  it('awaits rebuild when sandbox flips and rolls back opts on failure', async () => {
    const runtime = makeRuntime()
    factoryMock.mockResolvedValueOnce(runtime)
    const backend = new CursorBackend()
    await backend.start(makeOpts({ sandboxInfo: { enabled: false, autoAllowBash: false } }))

    // rebuild closes then start() — fail the new factory create, then succeed revive.
    factoryMock
      .mockRejectedValueOnce(new Error('sandbox helper missing'))
      .mockResolvedValueOnce(makeRuntime())
    await expect(backend.setSandbox({ enabled: true, autoAllowBash: false })).rejects.toThrow(
      'sandbox helper missing',
    )

    expect(factoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sandboxEnabled: false }),
    )
  })

  it('passes sandboxEnabled into the runtime factory on start', async () => {
    factoryMock.mockResolvedValueOnce(makeRuntime())
    const backend = new CursorBackend()
    await backend.start(makeOpts({ sandboxInfo: { enabled: true, autoAllowBash: false } }))
    expect(factoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxEnabled: true, permissionMode: 'auto' }),
    )
  })

  it('prewarm uses the official workspace API and does not create an agent', () => {
    const backend = new CursorBackend()
    backend.prewarm(makeOpts({ sandboxInfo: { enabled: true, autoAllowBash: false } }))
    expect(factoryMock).not.toHaveBeenCalled()
    expect(prewarmMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/p',
      sandboxEnabled: true,
      permissionMode: 'auto',
    }))
  })

  it('emits message_start before Agent.create resolves', async () => {
    let resolveFactory: ((runtime: ReturnType<typeof makeRuntime>) => void) | undefined
    factoryMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveFactory = resolve
    }))
    const backend = new CursorBackend()
    const events: string[] = []
    backend.onEvent((event) => { events.push(event.type) })
    await backend.start(makeOpts())
    const sendPromise = backend.send({ content: 'hi' })
    expect(events).toContain('message_start')
    expect(events).toContain('status_change')
    resolveFactory!(makeRuntime())
    await sendPromise
  })

  it('awaits rebuild when permission autoReview changes', async () => {
    const runtime = makeRuntime()
    factoryMock.mockResolvedValueOnce(runtime)
    const backend = new CursorBackend()
    await backend.start(makeOpts({ permissionMode: 'auto' }))

    factoryMock.mockResolvedValueOnce(makeRuntime())
    await backend.setPermissionMode('bypassPermissions')
    expect(factoryMock).toHaveBeenCalledTimes(2)
    expect(factoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: 'bypassPermissions' }),
    )
  })
})
