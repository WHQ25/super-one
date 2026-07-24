import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkContext, ForkSource } from '../types'

const mocks = vi.hoisted(() => ({
  startServer: vi.fn(async () => ({
    url: 'http://127.0.0.1:4000',
    exited: null,
    close: vi.fn(async () => undefined),
  })),
  clientOptions: null as unknown,
  forkSession: vi.fn(async () => ({ id: 'forked-session', directory: '/source' })),
  moveSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
}))

vi.mock('../../opencode/opencode-client', () => ({
  startOpenCodeServer: mocks.startServer,
  OpenCodeClient: class {
    constructor(options: unknown) { mocks.clientOptions = options }
    forkSession = mocks.forkSession
    moveSession = mocks.moveSession
    deleteSession = mocks.deleteSession
  },
}))

import { forkOpenCodeSession } from './opencode-fork'

function source(overrides: Partial<ForkSource> = {}): ForkSource {
  return {
    providerSessionId: 'source-session',
    projectPath: '/project',
    cwd: '/source',
    providerConfig: { serverUrl: 'http://127.0.0.1:4000', serverPassword: 'secret' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.clientOptions = null
  mocks.forkSession.mockResolvedValue({ id: 'forked-session', directory: '/source' })
})

describe('OpenCode session fork', () => {
  it('forks through the provider assistant anchor and moves the fork to its worktree', async () => {
    const ctx: ForkContext = {
      forkFromMessageId: 'assistant-local',
      messages: [{
        id: 'assistant-local', role: 'assistant', status: 'complete', content: [],
        createdAt: '', providerId: 'opencode', metadata: { forkAnchorId: 'assistant-provider' },
      }],
    }

    expect(await forkOpenCodeSession(source(), '/target-worktree', ctx)).toBe('forked-session')
    expect(mocks.startServer).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/source', serverUrl: 'http://127.0.0.1:4000',
    }))
    expect(mocks.clientOptions).toEqual(expect.objectContaining({ directory: '/source', password: 'secret' }))
    expect(mocks.forkSession).toHaveBeenCalledWith('source-session', 'assistant-provider')
    expect(mocks.moveSession).toHaveBeenCalledWith('forked-session', '/target-worktree')
  })

  it('uses the provider user checkpoint and skips a redundant local move', async () => {
    const ctx: ForkContext = {
      forkFromMessageId: 'user-local',
      messages: [{
        id: 'user-local', role: 'user', status: 'complete', content: [], createdAt: '',
        providerId: 'local', checkpointId: 'user-provider',
      }],
    }

    await forkOpenCodeSession(source(), '/source', ctx)
    expect(mocks.forkSession).toHaveBeenCalledWith('source-session', 'user-provider')
    expect(mocks.moveSession).not.toHaveBeenCalled()
  })

  it('rejects truncated forks when the selected message predates provider anchors', async () => {
    const ctx: ForkContext = {
      forkFromMessageId: 'assistant-local',
      messages: [{
        id: 'assistant-local', role: 'assistant', status: 'complete', content: [],
        createdAt: '', providerId: 'opencode',
      }],
    }

    await expect(forkOpenCodeSession(source(), '/source', ctx)).rejects.toThrow(/no provider fork anchor/)
    expect(mocks.forkSession).not.toHaveBeenCalled()
  })

  it('deletes the provider fork when moving it to the target worktree fails', async () => {
    mocks.moveSession.mockRejectedValueOnce(new Error('move failed'))

    await expect(forkOpenCodeSession(source(), '/target-worktree', { messages: [] })).rejects.toThrow('move failed')
    expect(mocks.deleteSession).toHaveBeenCalledWith('forked-session')
  })
})
