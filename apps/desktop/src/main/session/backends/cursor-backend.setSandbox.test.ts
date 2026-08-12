import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendStartOptions } from '../types'

const { factoryMock } = vi.hoisted(() => ({
  factoryMock: vi.fn(),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../cursor/cursor-runtime', () => ({
  getCursorRuntimeFactory: () => factoryMock,
  setCursorRuntimeFactory: vi.fn(),
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
