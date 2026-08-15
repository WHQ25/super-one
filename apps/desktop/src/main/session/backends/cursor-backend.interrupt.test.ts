import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
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
  mapPermissionToCursorLocal: () => ({ mode: 'agent', autoReview: true }),
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
    permissionMode: 'agent',
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
    send: vi.fn(() => new Promise<Record<string, never>>(() => {})),
    cancel: vi.fn().mockResolvedValue(undefined),
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

describe('CursorBackend interrupt', () => {
  beforeEach(() => {
    factoryMock.mockReset()
    prewarmMock.mockReset().mockResolvedValue(undefined)
  })

  // Regression: the terminal event is emitted after `runtime.cancel()`, so a
  // provider that stops answering used to strand Stop — the IPC never resolved
  // and the session never left `streaming`.
  it('still settles the turn when runtime.cancel() never answers', async () => {
    vi.useFakeTimers()
    try {
      factoryMock.mockResolvedValueOnce(makeRuntime({
        cancel: vi.fn(() => new Promise<void>(() => {})),
      }))
      const backend = new CursorBackend()
      const events: AgentEvent[] = []
      backend.onEvent((event) => events.push(event))
      await backend.start(makeOpts())

      void backend.send({ content: 'hello', assistantMessageId: 'assistant-local' })
      await vi.advanceTimersByTimeAsync(0)

      const interrupted = backend.interrupt()
      await vi.advanceTimersByTimeAsync(30_000)

      await expect(interrupted).resolves.toBeUndefined()
      expect(events.some((e) => e.type === 'message_interrupted' && e.messageId === 'assistant-local')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles the turn on the normal path where cancel resolves', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    factoryMock.mockResolvedValueOnce(makeRuntime({ cancel }))
    const backend = new CursorBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts())

    void backend.send({ content: 'hello', assistantMessageId: 'assistant-local' })
    await new Promise((r) => setTimeout(r, 0))

    await backend.interrupt()

    expect(cancel).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'message_interrupted' && e.messageId === 'assistant-local')).toBe(true)
  })
})
