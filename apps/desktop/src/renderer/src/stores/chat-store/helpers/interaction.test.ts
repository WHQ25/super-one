/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAgent = {
  parkSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockEnvRespondSessionQuestion = vi.fn()
const mockEnvRespondSessionPermission = vi.fn()
const mockEnvRespondSessionPlan = vi.fn()
const mockEnvPatchSessionSettings = vi.fn()
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
    respondSessionPlan: mockEnvRespondSessionPlan,
    patchSessionSettings: mockEnvPatchSessionSettings,
    getSession: mockEnvGetSession,
  },
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const { useChatStore } = await import('../index')
const { _resetRemoteQuestionInFlightForTests } = await import('./interaction')

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
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
    initializedHarnesses: new Set(),
  })
  vi.clearAllMocks()
  _resetRemoteQuestionInFlightForTests()
  mockEnvRespondSessionPlan.mockReset().mockResolvedValue(undefined)
  mockEnvPatchSessionSettings.mockReset().mockResolvedValue({})
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
  it('finishes an acknowledgement in the original session after the user switches sessions', async () => {
    let finish!: () => void
    mockEnvRespondSessionPermission.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const request = { requestId: 'form', toolName: 'composer_request', input: {}, allowAlwaysAllow: false } as never
    seedSession('owner', { pendingPermissions: [request] })
    const pending = useChatStore.getState().respondToPermission('form', true)
    const project = useChatStore.getState().projectSessions['/p1']
    useChatStore.setState({ projectSessions: { '/p1': { ...project, _activeSessionId: 'other', _sessions: {
      ...project._sessions, other: { ...createDefaultPerSessionState(), pendingPermissions: [request] },
    } } } })
    finish()
    expect(await pending).toBe(true)
    const sessions = useChatStore.getState().projectSessions['/p1']._sessions
    expect(sessions.owner.pendingPermissions).toEqual([])
    expect(sessions.other.pendingPermissions).toEqual([request])
  })

  it('keeps an input form pending when the host rejects its answer', async () => {
    mockEnvRespondSessionPermission.mockRejectedValueOnce(new Error('no pending request'))
    seedSession('owner', { pendingPermissions: [{ requestId: 'form', toolName: 'composer_request', input: {}, allowAlwaysAllow: false, requestKind: 'input_request' }] })
    expect(await useChatStore.getState().respondToPermission('form', true, undefined, undefined, undefined, undefined, { notes: 'draft' })).toBe(false)
    expect(activeSession().pendingPermissions[0]?.requestId).toBe('form')
  })
  it('approves and removes the matching request, leaving siblings intact', async () => {
    seedSession('sid-1', {
      pendingPermissions: [
        { requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false } as never,
        { requestId: 'r2', toolName: 'Edit', input: {}, allowAlwaysAllow: false } as never,
      ],
    })

    const result = await useChatStore.getState().respondToPermission('r1', true)

    expect(result).toBe(true)
    expect(mockEnvRespondSessionPermission).toHaveBeenCalledWith(
      'local', { sessionId: 'sid-1', interactionId: 'r1', decision: 'allow' },
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
    expect(mockEnvRespondSessionPermission).toHaveBeenCalledWith(
      'local', { sessionId: 'sid-1', interactionId: 'r1', decision: 'deny', reason: 'too risky' },
    )
    expect(activeSession().pendingPermissions).toHaveLength(0)
  })

  it('is a no-op for an unknown requestId (no IPC, no state change)', async () => {
    seedSession('sid-1', {
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false } as never],
    })

    const result = await useChatStore.getState().respondToPermission('does-not-exist', true)

    expect(result).toBe(false)
    expect(mockEnvRespondSessionPermission).not.toHaveBeenCalled()
    expect(activeSession().pendingPermissions).toHaveLength(1)
  })
})

describe('setPermissionModeImpl', () => {
  it('targets the initiating session and never a replacement that becomes active mid-flight', async () => {
    let resolveIpc!: (value: unknown) => void
    mockEnvPatchSessionSettings.mockReturnValue(new Promise((resolve) => { resolveIpc = resolve }))
    const project = createDefaultProjectState()
    project._activeSessionId = 'sid-1'
    project._sessions = {
      'sid-1': { ...createDefaultPerSessionState(), permissionMode: 'default', hostSessionOwned: true },
      'sid-2': { ...createDefaultPerSessionState(), permissionMode: 'plan', hostSessionOwned: true },
    }
    useChatStore.setState({ projectSessions: { '/p1': project }, activeProject: '/p1' })

    const pending = useChatStore.getState().setPermissionMode('acceptEdits')
    useChatStore.setState((state) => ({
      projectSessions: {
        ...state.projectSessions,
        '/p1': { ...state.projectSessions['/p1'], _activeSessionId: 'sid-2' },
      },
    }))
    resolveIpc({})
    await pending

    expect(mockEnvPatchSessionSettings).toHaveBeenCalledWith('local', 'sid-1', { permissionMode: 'acceptEdits' })
    const sessions = useChatStore.getState().projectSessions['/p1']._sessions
    expect(sessions['sid-1'].permissionMode).toBe('acceptEdits')
    expect(sessions['sid-2'].permissionMode).toBe('plan')
  })

  it('contains IPC failures so selector effects cannot create unhandled rejections', async () => {
    mockEnvPatchSessionSettings.mockRejectedValue(new Error('Session sid-1 is disposed'))
    seedSession('sid-1', { permissionMode: 'plan', hostSessionOwned: true })

    await expect(useChatStore.getState().setPermissionMode('default')).resolves.toBeUndefined()

    expect(activeSession().permissionMode).toBe('plan')
  })
})

describe('answerQuestionImpl', () => {
  it('sends the answer and clears pendingQuestion once the host acknowledges', async () => {
    seedSession('sid-1', {
      pendingQuestion: { requestId: 'q1', questions: [] } as never,
    })

    useChatStore.getState().answerQuestion('q1', { q: 'yes' })

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledWith('local', { sessionId: 'sid-1', interactionId: 'q1', answers: { q: 'yes' } })
    await vi.waitFor(() => expect(activeSession().pendingQuestion).toBeNull())
  })
})

describe('answerQuestionImpl: the Codex answer row', () => {
  const turn = (content: unknown[], items: unknown[]) => ({ id: 'turn', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'codex', content,
    metadata: { codex: { threadId: 't', usage: null, items } } })

  it('appends the answer to a content-shaped turn without turning it legacy', async () => {
    const before = [{ type: 'thinking', id: 'r', thinking: 'Planning' }, { type: 'text', id: 'a', text: 'Before the question' }]
    seedSession('sid-1', { sessionProvider: 'codex', pendingQuestion: PENDING_QUESTION as never, messages: [turn(before, [])] as never })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    await vi.waitFor(() => expect(activeSession().pendingQuestion).toBeNull())
    const message = activeSession().messages[0]!
    expect(message.metadata?.codex?.items).toEqual([])
    expect(message.content).toMatchObject([...before, { type: 'text', text: '**Pick one?**\nA' }])
  })

  it('adds the answer item to a legacy turn and derives its content', async () => {
    seedSession('sid-1', { sessionProvider: 'codex', pendingQuestion: PENDING_QUESTION as never,
      messages: [turn([], [{ id: 'a', type: 'agent_message', text: 'Before the question' }])] as never })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    await vi.waitFor(() => expect(activeSession().pendingQuestion).toBeNull())
    const message = activeSession().messages[0]!
    expect(message.metadata?.codex?.items).toHaveLength(2)
    expect(message.content).toMatchObject([{ text: 'Before the question' }, { text: '**Pick one?**\nA' }])
  })
})

/**
 * Issue #21: remote answerQuestion must ACK before clearing pendingQuestion,
 * clear the answering session (not active focus) and guard double-submit. What
 * the node does next arrives on the session's stream.
 */
describe('answerQuestionImpl: remote node (issue #21)', () => {
  it("addresses the node's connection through environment.respondSessionQuestion", () => {
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'sid-1',
        interactionId: 'q1',
        answers: { 'Pick one?': 'A' },
      }),
    )
  })

  it('keeps pendingQuestion when respondSessionQuestion rejects', async () => {
    mockEnvRespondSessionQuestion.mockRejectedValue(Object.assign(new Error('no matching pending question'), { code: 'failed_precondition' }))
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'A' })

    await vi.waitFor(() => expect(mockEnvRespondSessionQuestion).toHaveBeenCalled())
    await flushMicrotasks()
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

  it('ignores duplicate answer while the first RPC is in flight', async () => {
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
    useChatStore.getState().answerQuestion('q1', { 'Pick one?': 'B' })

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledTimes(1)
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

  it('clears the answering session even after active focus switches away', async () => {
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

    // Switch to another project before ACK — hydrate must still target sid-1.
    const other = createDefaultProjectState()
    other._activeSessionId = 'other-sid'
    other._sessions = { 'other-sid': createDefaultPerSessionState() }
    useChatStore.setState((s) => ({
      projectSessions: { ...s.projectSessions, '/local-other': other },
      activeProject: '/local-other',
    }))

    resolveRpc({
      sessionId: 'sid-1',
      status: 'streaming',
      harnessId: 'claude',
      pendingInteraction: null,
      transcript: [],
    })

    await vi.waitFor(() => {
      const remoteSess =
        useChatStore.getState().projectSessions[REMOTE_PATH]!._sessions['sid-1']
      expect(remoteSess.pendingQuestion).toBeNull()
    })
    // Newly focused local session must not have been touched.
    expect(
      useChatStore.getState().projectSessions['/local-other']!._sessions['other-sid']
        .pendingQuestion,
    ).toBeNull()
  })
})

describe('dismissQuestionImpl', () => {
  it('sends a dismiss (not an answer) and clears pendingQuestion once the host acknowledges', async () => {
    seedSession('sid-1', {
      pendingQuestion: { requestId: 'q1', questions: [] } as never,
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledTimes(1)
    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledWith('local', { sessionId: 'sid-1', interactionId: 'q1', answers: {}, dismiss: true })
    await vi.waitFor(() => expect(activeSession().pendingQuestion).toBeNull())
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
        dismiss: true,
      }),
    )
  })

  it('keeps pendingQuestion when remote dismiss RPC rejects', async () => {
    mockEnvRespondSessionQuestion.mockRejectedValue(new Error('lease expired'))
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().dismissQuestion('q1')

    await vi.waitFor(() => expect(mockEnvRespondSessionQuestion).toHaveBeenCalled())
    await flushMicrotasks()
    expect(activeSession().pendingQuestion?.requestId).toBe('q1')
  })
  it('does not clear pendingQuestion while dismiss RPC is still in flight', async () => {
    let resolveRpc!: (value: unknown) => void
    mockEnvRespondSessionQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve
      }),
    )
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().dismissQuestion('q1')
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

  it('ignores duplicate dismiss while the first RPC is in flight', async () => {
    let resolveRpc!: (value: unknown) => void
    mockEnvRespondSessionQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve
      }),
    )
    seedRemoteSession('sid-1', {
      pendingQuestion: { ...PENDING_QUESTION } as never,
    })

    useChatStore.getState().dismissQuestion('q1')
    useChatStore.getState().dismissQuestion('q1')

    expect(mockEnvRespondSessionQuestion).toHaveBeenCalledTimes(1)
    resolveRpc({
      sessionId: 'sid-1',
      status: 'idle',
      harnessId: 'claude',
      pendingInteraction: null,
      transcript: [],
    })
    await vi.waitFor(() => {
      expect(activeSession().pendingQuestion).toBeNull()
    })
  })
})

describe('respondToPlanApprovalImpl', () => {
  it('approve=true clears pending, stores outcome, and switches permission mode', () => {
    seedSession('sid-1', {
      permissionMode: 'plan',
      hostSessionOwned: true,
      pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    })

    useChatStore.getState().respondToPlanApproval('p1', true, undefined, 'acceptEdits')

    expect(mockEnvRespondSessionPlan).toHaveBeenCalledWith('local', { sessionId: 'sid-1', interactionId: 'p1', decision: 'approve', options: undefined })
    expect(mockEnvPatchSessionSettings).toHaveBeenCalledWith('local', 'sid-1', { permissionMode: 'acceptEdits' })
    const sess = activeSession()
    expect(sess.pendingPlanApproval).toBeNull()
    expect(sess.planApprovalOutcome).toEqual({ approved: true, feedback: undefined })
    expect(sess.permissionMode).toBe('acceptEdits')
  })

  it('approve=false with feedback stores feedback in planApprovalOutcome and skips setPermissionMode', () => {
    seedSession('sid-1', {
      permissionMode: 'plan',
      hostSessionOwned: true,
      pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    })

    useChatStore.getState().respondToPlanApproval('p1', false, 'no thanks')

    expect(mockEnvRespondSessionPlan).toHaveBeenCalledWith('local', { sessionId: 'sid-1', interactionId: 'p1', decision: 'reject', options: { feedback: 'no thanks' } })
    expect(mockEnvPatchSessionSettings).not.toHaveBeenCalled()
    const sess = activeSession()
    expect(sess.pendingPlanApproval).toBeNull()
    expect(sess.planApprovalOutcome).toEqual({ approved: false, feedback: 'no thanks' })
    expect(sess.permissionMode).toBe('plan')
  })

  it('does not reset ACP permissionMode to default on approve', () => {
    seedSession('sid-1', {
      sessionProvider: 'acp',
      permissionMode: 'plan',
      hostSessionOwned: true,
      pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    })

    useChatStore.getState().respondToPlanApproval('p1', true)

    expect(mockEnvRespondSessionPlan).toHaveBeenCalledWith('local', { sessionId: 'sid-1', interactionId: 'p1', decision: 'approve', options: undefined })
    expect(mockEnvPatchSessionSettings).not.toHaveBeenCalled()
    const sess = activeSession()
    expect(sess.pendingPlanApproval).toBeNull()
    expect(sess.permissionMode).toBe('plan')
  })

  it('is a no-op when no project is active', () => {
    useChatStore.setState({ projectSessions: {}, activeProject: null })

    useChatStore.getState().respondToPlanApproval('p-unknown', true)

    expect(mockEnvRespondSessionPlan).not.toHaveBeenCalled()
    expect(mockEnvPatchSessionSettings).not.toHaveBeenCalled()
  })
})
