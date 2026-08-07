/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAgent = {
  respondToPermission: vi.fn().mockResolvedValue(true),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  parkSession: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockEnvRespondSessionQuestion = vi.fn()
const mockEnvRespondSessionPermission = vi.fn()
const mockEnvGetSession = vi.fn()

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ sandboxCapability: null }) },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({}) },
}))

vi.stubGlobal('window', {
  agent: mockAgent,
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
  },
  environment: {
    respondSessionQuestion: mockEnvRespondSessionQuestion,
    respondSessionPermission: mockEnvRespondSessionPermission,
    getSession: mockEnvGetSession,
  },
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const { useChatStore } = await import('../index')

const REMOTE_PATH = 'remote:env-1:/work/app'
const PENDING_QUESTION = {
  requestId: 'q1',
  questions: [
    {
      question: 'Pick one?',
      options: [
        { label: 'A', description: 'option a' },
        { label: 'B', description: 'option b' },
      ],
    },
  ],
} as const

function seedSession(
  sid: string,
  patch: Partial<ReturnType<typeof createDefaultPerSessionState>> = {},
  projectPath = '/p1',
) {
  const proj = createDefaultProjectState()
  proj._activeSessionId = sid
  proj._sessions = { [sid]: { ...createDefaultPerSessionState(), ...patch } }
  useChatStore.setState({
    projectSessions: { [projectPath]: proj },
    activeProject: projectPath,
  })
}

function seedRemoteSession(
  sid: string,
  patch: Partial<ReturnType<typeof createDefaultPerSessionState>> = {},
) {
  seedSession(sid, { sessionProvider: 'claude', ...patch }, REMOTE_PATH)
}

function activeSession() {
  const s = useChatStore.getState()
  const proj = s.projectSessions[s.activeProject!]
  return proj._sessions[proj._activeSessionId!]
}

/** Drain microtasks so fire-and-forget promises settle under test. */
async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null },
    initializedHarnesses: new Set(),
  })
  vi.clearAllMocks()
  mockAgent.respondToPermission.mockResolvedValue(true)
  mockAgent.answerQuestion.mockResolvedValue(undefined)
  mockAgent.dismissQuestion.mockResolvedValue(undefined)
  mockEnvRespondSessionQuestion.mockReset().mockResolvedValue({
    sessionId: 'sid-1',
    status: 'streaming',
    harnessId: 'claude',
    pendingInteraction: null,
    transcript: [],
  })
  mockEnvRespondSessionPermission.mockReset().mockResolvedValue({
    sessionId: 'sid-1',
    status: 'streaming',
    harnessId: 'claude',
    pendingInteraction: null,
    transcript: [],
  })
  mockEnvGetSession.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('respondToPermissionImpl', () => {
  it('approves and removes the matching request, leaving siblings intact', async () => {
    seedSession('sid-1', {
      pendingPermissions: [
        { requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false } as never,
        { requestId: 'r2', toolName: 'Edit', input: {}, allowAlwaysAllow: false } as never,
      ],
    })

    const result = await useChatStore.getState().respondToPermission('r1', true)

    expect(result).toBe(true)
    expect(mockAgent.respondToPermission).toHaveBeenCalledWith(
      'sid-1', 'r1', true, undefined, undefined, undefined, undefined, undefined,
    )
    const remaining = activeSession().pendingPermissions
    expect(remaining.map((p) => p.requestId)).toEqual(['r2'])
  })

  it('denies with a reason and forwards it to the IPC call', async () => {
    seedSession('sid-1', {
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false } as never],
    })

    const result = await useChatStore.getState().respondToPermission('r1', false, undefined, 'too risky')

    expect(result).toBe(true)
    expect(mockAgent.respondToPermission).toHaveBeenCalledWith(
      'sid-1', 'r1', false, undefined, 'too risky', undefined, undefined, undefined,
    )
    expect(activeSession().pendingPermissions).toHaveLength(0)
  })

  it('is a no-op for an unknown requestId (no IPC, no state change)', async () => {
    seedSession('sid-1', {
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false } as never],
    })

    const result = await useChatStore.getState().respondToPermission('does-not-exist', true)

    expect(result).toBe(false)
    expect(mockAgent.respondToPermission).not.toHaveBeenCalled()
    expect(activeSession().pendingPermissions).toHaveLength(1)
  })
})

describe('answerQuestionImpl', () => {
  it('sends the answer and clears pendingQuestion', () => {
    seedSession('sid-1', {
      pendingQuestion: { requestId: 'q1', questions: [] } as never,
    })

    useChatStore.getState().answerQuestion('q1', { q: 'yes' })

    expect(mockAgent.answerQuestion).toHaveBeenCalledWith('sid-1', 'q1', { q: 'yes' }, undefined)
    expect(activeSession().pendingQuestion).toBeNull()
  })
})

/**
 * Issue #21: remote answerQuestion is fire-and-forget — clears pendingQuestion
 * before RPC settles, never restarts drain on failure, never hydrates on success.
 * These cases assert the correct contract (mirror respondToPermissionImpl remote path).
 */
describe('answerQuestionImpl: remote node (issue #21)', () => {
  it('routes through environment.respondSessionQuestion, not window.agent', () => {
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'sid-1',
        interactionId: 'q1',
        answers: { answers: { 'Pick one?': 'A' }, annotations: undefined },
        continueDrain: {
          projectPath: REMOTE_PATH,
          providerId: 'claude',
        },
      }),
    )
    expect(mockAgent.answerQuestion).not.toHaveBeenCalled()
  })

  it('keeps pendingQuestion when respondSessionQuestion rejects', async () => {
    // Bug repro: today we clear pendingQuestion in the same tick as the void RPC,
    // so a lease/network failure silently drops the prompt and never restarts drain.
    mockEnvRespondSessionQuestion.mockRejectedValue(
      Object.assign(new Error('no matching pending question'), { code: 'failed_precondition' }),
    )
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })
    await flushMicrotasks()

    expect(activeSession().pendingQuestion).not.toBeNull()
    expect(activeSession().pendingQuestion?.requestId).toBe('q1')
  })

  it('does not clear pendingQuestion while respondSessionQuestion is still in flight', async () => {
    let resolveRpc!: (value: unknown) => void
    mockEnvRespondSessionQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve
      }),
    )
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    // Correct contract: optimistic UI must not drop the prompt before ACK.
    expect(activeSession().pendingQuestion?.requestId).toBe('q1')

    resolveRpc({
      sessionId: 'sid-1',
      status: 'streaming',
      harnessId: 'claude',
      pendingInteraction: null,
      transcript: [],
    })

    await vi.waitFor(() => {
      expect(activeSession().pendingQuestion).toBeNull()
    })
  })

  it('on success hydrates pendingQuestion from the node snapshot (like permission path)', async () => {
    // Node still holds a different pending question after answer (or same if race).
    mockEnvRespondSessionQuestion.mockResolvedValue({
      sessionId: 'sid-1',
      status: 'streaming',
      harnessId: 'claude',
      pendingInteraction: {
        interactionId: 'q2',
        kind: 'question',
        input: {
          questions: [
            {
              question: 'Next?',
              options: [{ label: 'Yes', description: '' }],
            },
          ],
        },
      },
      transcript: [],
    })
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    await vi.waitFor(() => {
      expect(activeSession().pendingQuestion?.requestId).toBe('q2')
    })
  })
})

describe('dismissQuestionImpl', () => {
  it('clears pendingQuestion and only calls dismissQuestion (not answerQuestion)', () => {
    seedSession('sid-1', {
      pendingQuestion: { requestId: 'q1', questions: [] } as never,
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockAgent.dismissQuestion).toHaveBeenCalledWith('sid-1', 'q1')
    expect(mockAgent.answerQuestion).not.toHaveBeenCalled()
    expect(activeSession().pendingQuestion).toBeNull()
  })
})

describe('dismissQuestionImpl: remote node (issue #21)', () => {
  it('routes dismiss as empty-answers respondSessionQuestion', () => {
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'sid-1',
        interactionId: 'q1',
        answers: {},
        continueDrain: {
          projectPath: REMOTE_PATH,
          providerId: 'claude',
        },
      }),
    )
    expect(mockAgent.dismissQuestion).not.toHaveBeenCalled()
  })

  it('keeps pendingQuestion when remote dismiss RPC rejects', async () => {
    mockEnvRespondSessionQuestion.mockRejectedValue(new Error('lease expired'))
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().dismissQuestion('q1')
    await flushMicrotasks()

    expect(activeSession().pendingQuestion).not.toBeNull()
    expect(activeSession().pendingQuestion?.requestId).toBe('q1')
  })
})

describe('respondToPlanApprovalImpl', () => {
  it('approve=true clears pending, stores outcome, and switches permission mode', () => {
    seedSession('sid-1', {
      permissionMode: 'plan',
      pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    })

    useChatStore.getState().respondToPlanApproval('p1', true, undefined, 'acceptEdits')

    expect(mockAgent.respondToPlanApproval).toHaveBeenCalledWith('sid-1', 'p1', true, undefined)
    expect(mockAgent.setPermissionMode).toHaveBeenCalledWith('/p1', 'acceptEdits')
    const sess = activeSession()
    expect(sess.pendingPlanApproval).toBeNull()
    expect(sess.planApprovalOutcome).toEqual({ approved: true, feedback: undefined })
    expect(sess.permissionMode).toBe('acceptEdits')
  })

  it('approve=false with feedback stores feedback in planApprovalOutcome and skips setPermissionMode', () => {
    seedSession('sid-1', {
      permissionMode: 'plan',
      pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    })

    useChatStore.getState().respondToPlanApproval('p1', false, 'no thanks')

    expect(mockAgent.respondToPlanApproval).toHaveBeenCalledWith('sid-1', 'p1', false, 'no thanks')
    expect(mockAgent.setPermissionMode).not.toHaveBeenCalled()
    const sess = activeSession()
    expect(sess.pendingPlanApproval).toBeNull()
    expect(sess.planApprovalOutcome).toEqual({ approved: false, feedback: 'no thanks' })
    expect(sess.permissionMode).toBe('plan')
  })

  it('is a no-op when no project is active', () => {
    useChatStore.setState({ projectSessions: {}, activeProject: null })

    useChatStore.getState().respondToPlanApproval('p-unknown', true)

    expect(mockAgent.respondToPlanApproval).not.toHaveBeenCalled()
    expect(mockAgent.setPermissionMode).not.toHaveBeenCalled()
  })
})
