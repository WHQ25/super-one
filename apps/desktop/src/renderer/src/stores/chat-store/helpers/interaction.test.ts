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
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const { useChatStore } = await import('../index')

function seedSession(sid: string, patch: Partial<ReturnType<typeof createDefaultPerSessionState>> = {}) {
  const proj = createDefaultProjectState()
  proj._activeSessionId = sid
  proj._sessions = { [sid]: { ...createDefaultPerSessionState(), ...patch } }
  useChatStore.setState({
    projectSessions: { '/p1': proj },
    activeProject: '/p1',
  })
}

function activeSession() {
  const s = useChatStore.getState()
  const proj = s.projectSessions[s.activeProject!]
  return proj._sessions[proj._activeSessionId!]
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
