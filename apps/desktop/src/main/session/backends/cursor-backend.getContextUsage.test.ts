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

vi.mock('@superone/cursor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superone/cursor')>()
  return {
    ...actual,
    buildCursorModelSelection: () => undefined,
    resolveCursorSelectedContextWindow: () => 300_000,
  }
})

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
    model: 'opus',
    ...overrides,
  }
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'a1',
    isCloud: false,
    lastRunId: null,
    send: vi.fn().mockResolvedValue(undefined),
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

describe('CursorBackend getContextUsage', () => {
  beforeEach(() => {
    factoryMock.mockReset()
    prewarmMock.mockReset().mockResolvedValue(undefined)
  })

  it('uses last-prompt occupancy, not billed run cache', async () => {
    let onEvent: ((event: AgentEvent) => void) | undefined
    factoryMock.mockImplementation(async (opts: { onEvent: (event: AgentEvent) => void }) => {
      onEvent = opts.onEvent
      return makeRuntime()
    })

    const backend = new CursorBackend()
    await backend.start(makeOpts())
    await vi.waitFor(() => expect(onEvent).toBeDefined())

    onEvent!({
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 500_000,
      outputTokens: 20_000,
      cacheReadTokens: 1_400_000,
      contextTokens: 80_000,
    })

    await expect(backend.getContextUsage()).resolves.toMatchObject({
      totalTokens: 80_000,
      maxTokens: 300_000,
      percentage: 26.7,
      model: 'opus',
      categories: expect.arrayContaining([
        expect.objectContaining({ name: 'cacheRead', tokens: 1_400_000 }),
      ]),
    })
    await backend.close()
  })
})
