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

describe('CodexExperimentService child thread routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes snake_case child thread events into collab childItems instead of top-level items', async () => {
    const service = new CodexExperimentService()
    const session = { ...createSession('/project', null), threadId: 'main-thread' }
    const notifications = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-1',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            receiver_thread_ids: ['child-1'],
            agents_states: {
              'child-1': {
                status: 'running',
                nickname: 'worker',
              },
            },
          },
        },
      },
      {
        method: 'item/started',
        params: {
          thread_id: 'child-1',
          item: {
            id: 'child-msg-1',
            type: 'agent_message',
            text: 'child hello',
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          turn: {
            status: 'completed',
          },
        },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    }
    const onItemDelta = vi.fn()

    const result = await (service as any).streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    expect(mockConnection.request).toHaveBeenCalledWith('thread/resume', {
      threadId: 'child-1',
      persistExtendedHistory: false,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'collab-1',
      type: 'collab_tool_call',
      childItems: {
        'child-1': [
          {
            id: 'child-msg-1',
            type: 'agent_message',
            text: 'child hello',
          },
        ],
      },
    })
    expect(onItemDelta.mock.calls.some(([, item]) => item?.type === 'agent_message')).toBe(false)
  })
})

describe('CodexExperimentService run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests concise reasoning summary when reasoning effort is set', async () => {
    const service = new CodexExperimentService()
    const mockConnection = {
      request: vi.fn().mockResolvedValue({ turn: { id: 'turn-1' } }),
    }

    vi.spyOn(service as any, 'withAppServerConnection').mockImplementation(async (_auth, _signal, fn) => fn(mockConnection))
    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-1')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-1', usage: null, items: [] })

    await service.run('sid-1', '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      permissionPreset: 'default',
    })

    expect(mockConnection.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-1',
      model: 'gpt-5.4',
      effort: 'high',
      summary: 'concise',
    }))
  })

  it('does not request reasoning summary when reasoning effort is absent', async () => {
    const service = new CodexExperimentService()
    const mockConnection = {
      request: vi.fn().mockResolvedValue({ turn: { id: 'turn-2' } }),
    }

    vi.spyOn(service as any, 'withAppServerConnection').mockImplementation(async (_auth, _signal, fn) => fn(mockConnection))
    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-2')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-2', usage: null, items: [] })

    await service.run('sid-2', '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })

    expect(mockConnection.request).toHaveBeenCalledWith('turn/start', expect.any(Object))
    expect(mockConnection.request.mock.calls[0][1]).not.toHaveProperty('summary')
  })

  it('sends explicit default collaboration mode when plan mode is not selected', async () => {
    const service = new CodexExperimentService()
    const mockConnection = {
      request: vi.fn().mockResolvedValue({ turn: { id: 'turn-3' } }),
    }

    vi.spyOn(service as any, 'withAppServerConnection').mockImplementation(async (_auth, _signal, fn) => fn(mockConnection))
    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-3')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-3', usage: null, items: [] })

    await service.run('sid-3', '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'default',
      collaborationMode: 'default',
    })

    expect(mockConnection.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-3',
      collaborationMode: {
        mode: 'default',
        settings: {
          model: 'gpt-5.4',
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    }))
  })
})
